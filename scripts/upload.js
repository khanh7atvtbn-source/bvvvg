const fs = require("fs");
const http = require("http");
const https = require("https");
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

function getHidemiumApiUrls() {
  if (config.hidemium.apiUrl) return [config.hidemium.apiUrl];
  return ["http://127.0.0.1:2222", "http://127.0.0.1:5555"];
}

function getHidemiumUuid(account) {
  return account.hidemiumUuid || account.uuid || account.profileUuid;
}

function isPlaceholderUuid(uuid) {
  return /^uuid-profile-/i.test(String(uuid || ""));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, timeout = config.timeouts.default) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      { method: "GET", timeout },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let data = body;
          if (body) {
            try {
              data = JSON.parse(body);
            } catch (_) {
              // Keep the raw response for clearer API errors.
            }
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}: ${body}`));
            return;
          }
          resolve(data);
        });
      },
    );

    request.on("timeout", () =>
      request.destroy(new Error(`Timeout khi goi ${url}`)),
    );
    request.on("error", reject);
    request.end();
  });
}

async function hidemiumGet(pathName, params) {
  const errors = [];
  for (const apiUrl of getHidemiumApiUrls()) {
    const url = new URL(pathName, apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    try {
      return { apiUrl, data: await requestJson(url.toString()) };
    } catch (error) {
      // Some Hidemium errors return HTTP 400 with a JSON body like
      // {"status":"error","data":{"message":"Profile is opening."}}
      // requestJson currently throws for non-2xx responses and includes
      // the response body in the error message. Try to detect that case
      // and return the parsed response so callers can inspect the message
      // and decide to retry instead of treating it as a hard failure.
      let parsed = null;
      try {
        const msg = String(error.message || "");
        // Strip any leading "HTTP <code>: " if present
        const jsonPart = msg.replace(/^HTTP\s\d+:\s*/, "");
        parsed = JSON.parse(jsonPart);
      } catch (_) {
        parsed = null;
      }

      if (parsed && (parsed.status === "error" || parsed.data)) {
        return { apiUrl, data: parsed };
      }

      errors.push(`${apiUrl}: ${error.message}`);
    }
  }

  throw new Error(`Khong goi duoc Hidemium API. Da thu: ${errors.join(" | ")}`);
}

function getAccount(name) {
  const accountName = name || accountConfig.defaultAccount;
  const account = accountConfig.accounts[accountName];
  if (!account) {
    const available = Object.keys(accountConfig.accounts).join(", ");
    throw new Error(
      `Account "${accountName}" khong ton tai. Co san: ${available}`,
    );
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

async function launchLocalProfile(profileDir) {
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
    appendLog(
      "error.log",
      `Khong mo duoc channel ${config.browser.channel}, fallback Chromium: ${error.message}`,
    );
    return chromium.launchPersistentContext(profileDir, launchOptions);
  }
}

async function openHidemiumProfile(account) {
  const uuid = getHidemiumUuid(account);
  if (!uuid || isPlaceholderUuid(uuid)) {
    throw new Error(
      `Account "${account.name}" chua co UUID Hidemium that. Hay dien trong config/accounts.js hoac set bien moi truong HIDEMIUM_${String(account.name).toUpperCase()}_UUID.`,
    );
  }

  const command = account.hidemiumCommand || config.hidemium.command;
  const proxy = account.hidemiumProxy || "";
  const paramVariants = [
    { uuid, command, proxy },
    { id: uuid, command, proxy },
    { profile_uuid: uuid, command, proxy },
  ];

  const maxAttempts = 10; // increased from 5
  const baseDelay = 5000; // ms, increased from 2000
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const params of paramVariants) {
      try {
        const response = await hidemiumGet("openProfile", params);
        const remotePort =
          response.data && response.data.data && response.data.data.remote_port;
        const message =
          response.data && response.data.data && response.data.data.message;
        if (remotePort) {
          appendLog(
            "upload.log",
            `Da mo Hidemium profile via ${Object.keys(params).join(",")} uuid=${uuid} port=${remotePort}`,
          );
          const browser = await chromium.connectOverCDP(
            `http://127.0.0.1:${remotePort}`,
            {
              slowMo: config.browser.slowMo,
              timeout: config.timeouts.default,
              isLocal: true,
            },
          );
          const context = browser.contexts()[0] || (await browser.newContext());
          return {
            context,
            close: async () => {
              await browser.close().catch(() => null);
              if (config.hidemium.closeProfileWhenDone) {
                await hidemiumGet("closeProfile", { uuid }).catch((error) => {
                  appendLog(
                    "error.log",
                    `Khong dong duoc Hidemium profile uuid=${uuid}: ${error.message}`,
                  );
                });
              }
            },
          };
        }
        if (message && message.toLowerCase().includes("profile is opening")) {
          // Profile still opening, wait and retry
          appendLog(
            "upload.log",
            `Profile is opening for uuid=${uuid}, attempt ${attempt}, retrying after delay...`,
          );
          await delay(baseDelay * attempt);
          continue; // retry same params
        }
        // If response doesn't contain port or known message, treat as error
        lastError = new Error(
          message || "Unknown response from Hidemium openProfile",
        );
      } catch (error) {
        lastError = error;
        // If connection refused, maybe Hidemium not running; break early
        if (error.message && error.message.includes("ECONNREFUSED")) {
          appendLog(
            "error.log",
            `Connection refused to Hidemium at attempt ${attempt}: ${error.message}`,
          );
          // No point retrying quickly, break to outer loop
          break;
        }
      }
    }
    // Delay before next overall attempt
    if (attempt < maxAttempts) {
      await delay(baseDelay * attempt);
    }
  }

  // If all attempts fail, fallback to local provider if configured
  if (config.browser.provider !== "hidemium") {
    appendLog(
      "upload.log",
      `All Hidemium attempts failed; falling back to local browser provider.`,
    );
    // Caller will handle launching local profile via launchLocalProfile.
    throw new Error("Hidemium unavailable; fallback to local provider.");
  }

  throw new Error(
    `Khong goi duoc Hidemium API openProfile voi profile ${uuid}: ${lastError ? lastError.message : "Unknown error"}`,
  );
}

async function launchBrowserSession(account) {
  if (config.browser.provider === "hidemium") {
    return await openHidemiumProfile(account);
  }

  if (config.browser.provider === "local") {
    const os = require("os");
    const path = require("path");
    const profileDir = account.profileDir;
    let context;

    try {
      context = await launchLocalProfile(profileDir);
    } catch (e2) {
      appendLog(
        "error.log",
        `Local profile launch failed (${profileDir}): ${e2.message}. Falling back to temporary profile.`,
      );
      const tempProfileDir = path.join(
        os.tmpdir(),
        `playwright_profile_${Date.now()}`,
      );
      context = await launchLocalProfile(tempProfileDir);
    }

    return {
      context,
      close: () => context.close(),
    };
  }

  throw new Error('browser.provider chi nhan "hidemium" hoac "local".');
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
    await locator
      .first()
      .waitFor({ state: "attached", timeout: 300 })
      .catch(() => null);
  }
  return null;
}

async function clickFirst(page, candidates, timeout = 5000) {
  for (const candidate of candidates) {
    const locator =
      typeof candidate === "string" ? page.locator(candidate) : candidate;
    const target = await firstVisible(locator, timeout).catch(() => null);
    if (!target) continue;
    try {
      await target.click({ timeout });
      return true;
    } catch (_) {
      // YouTube Studio sometimes leaves a transient overlay over buttons.
      // Try the next candidate instead of failing the whole flow here.
    }
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
    const target = await firstVisible(page.locator(selector), 1500).catch(
      () => null,
    );
    if (target) {
      await target.fill(String(value));
      return;
    }
  }

  const fallback = page.locator(
    'ytcp-social-suggestions-textbox #textbox[contenteditable="true"], div[contenteditable="true"]',
  );
  const count = await fallback.count();
  if (count > fallbackIndex) {
    await fallback.nth(fallbackIndex).fill(String(value));
    return;
  }

  throw new Error(`Khong tim thay o nhap ${purpose}.`);
}

async function setTags(page, tags) {
  if (!tags.length) return;

  await clickFirst(
    page,
    [
      page.getByText(/^Show more$/i),
      page.getByText(/^Hiện thêm$/i),
      page.getByText(/^Hien them$/i),
    ],
    2000,
  ).catch(() => null);

  const tagBox = await firstVisible(
    page.locator(
      '[aria-label*="tag" i], [aria-label*="Tags" i], [aria-label*="thẻ" i]',
    ),
    2000,
  ).catch(() => null);
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
  const clicked = await clickFirst(
    page,
    [
      "#next-button",
      page.getByRole("button", { name: /^Next$/i }),
      page.getByRole("button", { name: /^Tiếp$/i }),
      page.getByText(/^Next$/i),
      page.getByText(/^Tiếp$/i),
    ],
    10000,
  );

  if (!clicked) throw new Error("Khong tim thay nut Next/Tiep.");
  await page.waitForTimeout(1200);
}

async function setPrivacy(page, privacy) {
  const upperPrivacy = privacy.toUpperCase();
  const selectors = [
    `[name="${upperPrivacy}"]`,
    `tp-yt-paper-radio-button[name="${upperPrivacy}"]`,
    `paper-radio-button[name="${upperPrivacy}"]`,
    `#${privacy}-radio-button`,
  ];

  for (const selector of selectors) {
    const option = page.locator(selector).first();
    try {
      if (await option.count() > 0) {
        await option.waitFor({ state: "visible", timeout: 3000 });
        await option.click();
        return;
      }
    } catch (_) {
      // Try the next selector
    }
  }

  // Fallback to text matching
  const labels = PRIVACY_LABELS[privacy];
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
  const link = await firstVisible(
    page.locator('a[href*="youtu.be/"], a[href*="youtube.com/watch"]'),
    10000,
  ).catch(() => null);
  if (!link) return null;
  return link.getAttribute("href");
}

async function dismissBlockingOverlays(page) {
  const textButtons = [
    /^Got it$/i,
    /^Dismiss$/i,
    /^Close$/i,
    /^No thanks$/i,
    /^Skip$/i,
    /^OK$/i,
    /^Đã hiểu$/i,
    /^Dong$/i,
    /^Đóng$/i,
    /^Bo qua$/i,
    /^Bỏ qua$/i,
    /^Khong cam on$/i,
    /^Không cảm ơn$/i,
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.keyboard.press("Escape").catch(() => null);
    await page.waitForTimeout(500);

    let clicked = false;
    for (const label of textButtons) {
      clicked = await clickFirst(
        page,
        [
          page.getByRole("button", { name: label }),
          page.getByText(label),
          `[aria-label="${label.source.replace(/^\^|\$\/i$/g, "")}"]`,
        ],
        800,
      ).catch(() => false);
      if (clicked) break;
    }

    if (!clicked) break;
    await page.waitForTimeout(800);
  }
}

async function findUploadFileInput(page, timeout = 3000) {
  const input = page.locator('ytcp-uploads-dialog input[type="file"], [role="dialog"] input[type="file"]').first();
  try {
    await input.waitFor({ state: "attached", timeout });
    return input;
  } catch (_) {
    return null;
  }
}

async function openUploadDialog(page) {
  await page.goto("https://studio.youtube.com/?create=upload", {
    waitUntil: "domcontentloaded",
    timeout: config.timeouts.navigation,
  });

  await dismissBlockingOverlays(page);

  const directInput = await findUploadFileInput(page, 8000);
  if (directInput) return directInput;

  await page.goto("https://studio.youtube.com", {
    waitUntil: "domcontentloaded",
    timeout: config.timeouts.navigation,
  });

  await dismissBlockingOverlays(page);

  const input = await findUploadFileInput(page, 2000);
  if (input) return input;

  const opened = await clickFirst(
    page,
    [
      "#create-icon",
      "ytcp-button#create-icon",
      "ytcp-icon-button#create-icon",
      '[aria-label="Create"]',
      '[aria-label="Tạo"]',
      '[aria-label="Tao"]',
      '[aria-label*="Create" i]',
      '[aria-label*="Tạo" i]',
      '[aria-label*="Tao" i]',
      page.getByRole("button", { name: /^Create$/i }),
      page.getByRole("button", { name: /^Tạo$/i }),
    ],
    15000,
  );
  if (!opened)
    throw new Error("Khong tim thay nut Create/Tao trong YouTube Studio.");

  const selectedUpload = await clickFirst(
    page,
    [
      page.getByText(/^Upload videos$/i),
      page.getByText(/^Tải video lên$/i),
      page.getByText(/^Tai video len$/i),
      'tp-yt-paper-item:has-text("Upload")',
      'tp-yt-paper-item:has-text("Tải")',
    ],
    10000,
  );
  if (!selectedUpload) throw new Error("Khong tim thay menu Upload videos.");

  const uploadInput = await findUploadFileInput(page, config.timeouts.default);
  if (!uploadInput) throw new Error("Khong tim thay input chon file upload.");
  return uploadInput;
}

async function uploadVideo({ accountName, account, video, keepOpen = false }) {
  appendLog(
    "upload.log",
    `Bat dau upload account=${accountName} file=${video.filePath}`,
  );
  const session = await launchBrowserSession(account);
  const { context } = session;
  let result = null;

  try {
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(config.timeouts.default);

    const fileInput = await openUploadDialog(page);
    await fileInput.setInputFiles(video.filePath);

    const dialog = page.locator('ytcp-uploads-dialog, [role="dialog"]');
    const titleField = page.locator(
      'ytcp-social-suggestions-textbox #textbox[contenteditable="true"], div[contenteditable="true"]',
    );

    try {
      await Promise.race([
        dialog
          .first()
          .waitFor({ state: "visible", timeout: config.timeouts.upload }),
        titleField
          .first()
          .waitFor({ state: "visible", timeout: config.timeouts.upload }),
      ]);
    } catch (error) {
      appendLog(
        "error.log",
        `Upload dialog or title field did not appear after ${config.timeouts.upload}ms: ${error.message}`,
      );
    }

    await fillContentEditable(page, "title", video.title, 0);
    await fillContentEditable(page, "description", video.description || "", 1);

    if (video.thumbnailPath) {
      const thumbnailInput = page
        .locator('input[type="file"][accept*="image"]')
        .first();
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
      appendLog(
        "success.log",
        `Upload xong account=${accountName} title="${video.title}" url=${url || "unknown"}`,
      );
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
      appendLog(
        "upload.log",
        `Da dung truoc buoc Publish/Save title="${video.title}"`,
      );
    }

    if (!keepOpen && video.closeBrowserWhenDone !== false) {
      await session.close();
    }
    return result;
  } catch (error) {
    if (session && session.context) {
      try {
        const page = session.context.pages()[0];
        if (page) {
          const screenshotName = `error_${accountName}_${Date.now()}.png`;
          const screenshotPath = path.join(config.paths.logs, screenshotName);
          fs.mkdirSync(config.paths.logs, { recursive: true });
          await page.screenshot({ path: screenshotPath });
          appendLog(
            "error.log",
            `[screenshot] Da luu anh chup man hinh loi tai: ${screenshotPath}`,
          );
        }
      } catch (screenshotError) {
        appendLog(
          "error.log",
          `Khong the chup anh man hinh loi: ${screenshotError.message}`,
        );
      }
    }

    appendLog(
      "error.log",
      `Upload loi account=${accountName}: ${error.stack || error.message}`,
    );
    if (!keepOpen) await session.close().catch(() => null);
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
  launchBrowserSession,
  normalizeVideo,
  parseArgs,
  readJson,
  uploadVideo,
  writeJson,
};
