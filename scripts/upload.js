const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const config = require("../config/config");
const accountConfig = require("../config/accounts");

const PRIVACY_LABELS = {
  private: [/^Private$/i, /^Riêng tư$/i],
  unlisted: [/^Unlisted$/i, /^Không công khai$/i],
  public: [/^Public$/i, /^Công khai$/i],
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function resolveProjectPath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(config.rootDir, value);
}

function appendLog(fileName, message) {
  fs.mkdirSync(config.paths.logs, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(config.paths.logs, fileName), line);
}

function getAccount(name) {
  const accountName = name || accountConfig.defaultAccount;
  const account = accountConfig.accounts[accountName];
  if (!account) {
    const available = Object.keys(accountConfig.accounts).join(", ");
    throw new Error(`Account "${accountName}" khong ton tai. Co san: ${available}`);
  }
  return { accountName, account };
}

function normalizeVideo(input, overrides = {}) {
  const video = {
    ...config.uploadDefaults,
    ...input,
    ...overrides,
  };

  video.filePath = resolveProjectPath(video.filePath || video.path);
  video.thumbnailPath = resolveProjectPath(video.thumbnailPath);
  video.privacy = String(video.privacy || "private").toLowerCase();
  video.tags = Array.isArray(video.tags)
    ? video.tags
    : String(video.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);

  if (!video.filePath) throw new Error("Thieu filePath trong video config.");
  if (!fs.existsSync(video.filePath)) {
    throw new Error(`Khong tim thay video: ${video.filePath}`);
  }
  if (!video.title) {
    video.title = path.basename(video.filePath, path.extname(video.filePath));
  }
  if (video.thumbnailPath && !fs.existsSync(video.thumbnailPath)) {
    throw new Error(`Khong tim thay thumbnail: ${video.thumbnailPath}`);
  }
  if (!PRIVACY_LABELS[video.privacy]) {
    throw new Error('privacy chi nhan "private", "unlisted", hoac "public".');
  }

  return video;
}

async function launchProfile(profileDir) {
  fs.mkdirSync(profileDir, { recursive: true });
  const launchOptions = {
    headless: config.browser.headless,
    slowMo: config.browser.slowMo,
    viewport: config.browser.viewport,
    args: ["--disable-blink-features=AutomationControlled"],
  };

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...launchOptions,
      channel: config.browser.channel,
    });
  } catch (error) {
    if (!config.browser.channel) throw error;
    appendLog("error.log", `Khong mo duoc channel ${config.browser.channel}, fallback Chromium: ${error.message}`);
    return chromium.launchPersistentContext(profileDir, launchOptions);
  }
}

async function firstVisible(locator, timeout = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      try {
        await item.waitFor({ state: "visible", timeout: 300 });
        return item;
      } catch (_) {
        // Try the next matching element.
      }
    }
    await locator.first().waitFor({ state: "attached", timeout: 300 }).catch(() => null);
  }
  return null;
}

async function clickFirst(page, candidates, timeout = 5000) {
  for (const candidate of candidates) {
    const locator = typeof candidate === "string" ? page.locator(candidate) : candidate;
    const target = await firstVisible(locator, timeout).catch(() => null);
    if (!target) continue;
    await target.click({ timeout });
    return true;
  }
  return false;
}

async function fillContentEditable(page, purpose, value, fallbackIndex) {
  if (value === undefined || value === null) return;

  const selectors = {
    title: [
      '[aria-label*="title" i][contenteditable="true"]',
      '[aria-label*="tieu de" i][contenteditable="true"]',
      '[aria-label*="tiêu đề" i][contenteditable="true"]',
    ],
    description: [
      '[aria-label*="description" i][contenteditable="true"]',
      '[aria-label*="mo ta" i][contenteditable="true"]',
      '[aria-label*="mô tả" i][contenteditable="true"]',
    ],
  };

  for (const selector of selectors[purpose]) {
    const target = await firstVisible(page.locator(selector), 1500).catch(() => null);
    if (target) {
      await target.fill(String(value));
      return;
    }
  }

  const fallback = page.locator('ytcp-social-suggestions-textbox #textbox[contenteditable="true"], div[contenteditable="true"]');
  const count = await fallback.count();
  if (count > fallbackIndex) {
    await fallback.nth(fallbackIndex).fill(String(value));
    return;
  }

  throw new Error(`Khong tim thay o nhap ${purpose}.`);
}

async function setTags(page, tags) {
  if (!tags.length) return;

  await clickFirst(page, [
    page.getByText(/^Show more$/i),
    page.getByText(/^Hiện thêm$/i),
    page.getByText(/^Hien them$/i),
  ], 2000).catch(() => null);

  const tagBox = await firstVisible(page.locator('[aria-label*="tag" i], [aria-label*="Tags" i], [aria-label*="thẻ" i]'), 2000).catch(() => null);
  if (!tagBox) return;

  await tagBox.fill(tags.join(", "));
}

async function setMadeForKids(page, madeForKids) {
  const labels = madeForKids
    ? [/Yes,.*made for kids/i, /Co,.*tre em/i, /Có,.*trẻ em/i]
    : [/No,.*made for kids/i, /Khong,.*tre em/i, /Không,.*trẻ em/i];

  for (const label of labels) {
    const option = page.getByText(label).first();
    try {
      await option.waitFor({ state: "visible", timeout: 3000 });
      await option.click();
      return;
    } catch (_) {
      // Try the next language variant.
    }
  }
}

async function clickNext(page) {
  const clicked = await clickFirst(page, [
    "#next-button",
    page.getByRole("button", { name: /^Next$/i }),
    page.getByRole("button", { name: /^Tiếp$/i }),
    page.getByText(/^Next$/i),
    page.getByText(/^Tiếp$/i),
  ], 10000);

  if (!clicked) throw new Error("Khong tim thay nut Next/Tiep.");
  await page.waitForTimeout(1200);
}

async function setPrivacy(page, privacy) {
  const labels = PRIVACY_LABELS[privacy];
  for (const label of labels) {
    const option = page.getByText(label).first();
    try {
      await option.waitFor({ state: "visible", timeout: 5000 });
      await option.click();
      return;
    } catch (_) {
      // Try the next language variant.
    }
  }
  throw new Error(`Khong chon duoc privacy: ${privacy}`);
}

async function clickDone(page, publish) {
  const names = publish
    ? [/^Publish$/i, /^Save$/i, /^Done$/i, /^Xuất bản$/i, /^Lưu$/i, /^Xong$/i]
    : [/^Save$/i, /^Done$/i, /^Lưu$/i, /^Xong$/i];

  const candidates = [
    "#done-button",
    ...names.map((name) => page.getByRole("button", { name })),
    ...names.map((name) => page.getByText(name)),
  ];

  const clicked = await clickFirst(page, candidates, config.timeouts.upload);
  if (!clicked) throw new Error("Khong tim thay nut Publish/Save/Done.");
}

async function extractVideoUrl(page) {
  const link = await firstVisible(page.locator('a[href*="youtu.be/"], a[href*="youtube.com/watch"]'), 10000).catch(() => null);
  if (!link) return null;
  return link.getAttribute("href");
}

async function openUploadDialog(page) {
  await page.goto("https://studio.youtube.com", {
    waitUntil: "domcontentloaded",
    timeout: config.timeouts.navigation,
  });

  const input = page.locator('input[type="file"]').first();
  if (await input.count()) return input;

  const opened = await clickFirst(page, [
    "#create-icon",
    '[aria-label="Create"]',
    '[aria-label="Tạo"]',
    '[aria-label*="Create" i]',
    '[aria-label*="Tạo" i]',
  ], 15000);
  if (!opened) throw new Error("Khong tim thay nut Create/Tao trong YouTube Studio.");

  const selectedUpload = await clickFirst(page, [
    page.getByText(/^Upload videos$/i),
    page.getByText(/^Tải video lên$/i),
    page.getByText(/^Tai video len$/i),
    'tp-yt-paper-item:has-text("Upload")',
    'tp-yt-paper-item:has-text("Tải")',
  ], 10000);
  if (!selectedUpload) throw new Error("Khong tim thay menu Upload videos.");

  await page.locator('input[type="file"]').first().waitFor({
    state: "attached",
    timeout: config.timeouts.default,
  });
  return page.locator('input[type="file"]').first();
}

async function uploadVideo({ accountName, account, video, keepOpen = false }) {
  appendLog("upload.log", `Bat dau upload account=${accountName} file=${video.filePath}`);
  const context = await launchProfile(account.profileDir);
  let result = null;

  try {
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(config.timeouts.default);

    const fileInput = await openUploadDialog(page);
    await fileInput.setInputFiles(video.filePath);

    await page.locator('ytcp-uploads-dialog, [role="dialog"]').first().waitFor({
      state: "visible",
      timeout: config.timeouts.default,
    });

    await fillContentEditable(page, "title", video.title, 0);
    await fillContentEditable(page, "description", video.description || "", 1);

    if (video.thumbnailPath) {
      const thumbnailInput = page.locator('input[type="file"][accept*="image"]').first();
      if (await thumbnailInput.count()) {
        await thumbnailInput.setInputFiles(video.thumbnailPath);
      }
    }

    await setTags(page, video.tags);
    await setMadeForKids(page, Boolean(video.madeForKids));

    await clickNext(page);
    await clickNext(page);
    await clickNext(page);
    await setPrivacy(page, video.privacy);

    if (video.publish !== false) {
      await clickDone(page, true);
      const url = await extractVideoUrl(page);
      result = {
        account: accountName,
        title: video.title,
        filePath: video.filePath,
        privacy: video.privacy,
        url,
        uploadedAt: new Date().toISOString(),
      };
      appendLog("success.log", `Upload xong account=${accountName} title="${video.title}" url=${url || "unknown"}`);
    } else {
      result = {
        account: accountName,
        title: video.title,
        filePath: video.filePath,
        privacy: video.privacy,
        url: null,
        uploadedAt: null,
        note: "Da dien metadata nhung chua bam Publish/Save do publish=false.",
      };
      appendLog("upload.log", `Da dung truoc buoc Publish/Save title="${video.title}"`);
    }

    if (!keepOpen && video.closeBrowserWhenDone !== false) {
      await context.close();
    }
    return result;
  } catch (error) {
    appendLog("error.log", `Upload loi account=${accountName}: ${error.stack || error.message}`);
    if (!keepOpen) await context.close().catch(() => null);
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { accountName, account } = getAccount(args.account);
  const videoConfigPath = resolveProjectPath(args.video || config.paths.video);
  const input = readJson(videoConfigPath, {});
  const overrides = {};
  if (args.file) overrides.filePath = args.file;
  if (args.title) overrides.title = args.title;
  if (args.description) overrides.description = args.description;
  if (args.privacy) overrides.privacy = args.privacy;
  if (args["keep-open"]) overrides.closeBrowserWhenDone = false;
  if (args["no-publish"]) overrides.publish = false;

  const video = normalizeVideo(input, overrides);
  const result = await uploadVideo({
    accountName,
    account,
    video,
    keepOpen: Boolean(args["keep-open"]),
  });

  const uploaded = readJson(config.paths.uploaded, []);
  uploaded.push(result);
  writeJson(config.paths.uploaded, uploaded);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  getAccount,
  normalizeVideo,
  parseArgs,
  readJson,
  uploadVideo,
  writeJson,
};
