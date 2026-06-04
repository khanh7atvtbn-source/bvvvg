const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const queuePath = path.join(rootDir, "data", "reup-queue.json");
const reupScriptPath = path.join(rootDir, "scripts", "reup.js");
const accountConfig = require("../config/accounts");
const hidemiumApi = require("../scripts/utils/hidemium-api");

let mainWindow = null;
let activeJob = null;

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

function readQueue() {
  const queue = readJson(queuePath, []);
  if (!Array.isArray(queue)) return [];
  return queue.map((item) => ({
    ...item,
    done: Boolean(item.done || (item.url && !item.error)),
  }));
}

function saveQueue(queue) {
  writeJson(queuePath, queue);
}

function getNextId(queue) {
  const maxId = queue.reduce((max, item) => {
    const numeric = Number(item.id);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);
  return maxId + 1;
}

function sanitizeQueueItem(input, existing = {}) {
  const source = String(input.source || "").trim();
  const sourceType =
    input.source_type === "url" || /^https?:\/\//i.test(source) ? "url" : "local";
  const title = String(input.title || "").trim();
  const account = String(input.account || accountConfig.defaultAccount).trim();
  const visibility = String(input.visibility || input.privacy || "private").trim();

  if (!source) throw new Error("Thieu source video.");
  if (!title) throw new Error("Thieu tieu de video.");
  if (!accountConfig.accounts[account]) throw new Error(`Account khong ton tai: ${account}`);
  if (!["private", "unlisted", "public"].includes(visibility)) {
    throw new Error("Visibility chi nhan private, unlisted hoac public.");
  }

  return {
    ...existing,
    account,
    source_type: sourceType,
    source,
    title: title.slice(0, 100),
    description: String(input.description || ""),
    visibility,
    madeForKids: Boolean(input.madeForKids),
    done: Boolean(existing.done && input.done !== false),
    uploadedAt: existing.uploadedAt || "",
    url: existing.url || "",
    error: input.error === "" ? "" : existing.error || "",
  };
}

function getAppState() {
  const accounts = Object.keys(accountConfig.accounts).map((name) => ({
    name,
    hasHidemiumUuid: Boolean(accountConfig.accounts[name].hidemiumUuid),
    hidemiumUuid: accountConfig.accounts[name].hidemiumUuid || "",
  }));

  return {
    accounts,
    defaultAccount: accountConfig.defaultAccount,
    hidemiumApiHelperVersion: hidemiumApi.HIDEMIUM_API_HELPER_VERSION,
    hidemiumApiUrls: hidemiumApi.getApiUrls(),
    queue: readQueue(),
    isRunning: Boolean(activeJob),
    paths: {
      rootDir,
      queuePath,
      defaultVideoFolder: path.join(
        rootDir,
        "accounts",
        accountConfig.defaultAccount,
        "videos",
      ),
    },
  };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: "#f4f5f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("app:get-state", () => getAppState());

ipcMain.handle("queue:add", (_event, input) => {
  const queue = readQueue();
  const item = {
    id: getNextId(queue),
    ...sanitizeQueueItem(input),
    done: false,
    uploadedAt: "",
    url: "",
    error: "",
  };
  queue.push(item);
  saveQueue(queue);
  return getAppState();
});

ipcMain.handle("queue:update", (_event, id, input) => {
  const queue = readQueue();
  const index = queue.findIndex((item) => String(item.id) === String(id));
  if (index === -1) throw new Error(`Khong tim thay item #${id}`);
  queue[index] = {
    ...sanitizeQueueItem(input, queue[index]),
    id: queue[index].id,
  };
  saveQueue(queue);
  return getAppState();
});

ipcMain.handle("queue:retry", (_event, id) => {
  const queue = readQueue();
  const index = queue.findIndex((item) => String(item.id) === String(id));
  if (index === -1) throw new Error(`Khong tim thay item #${id}`);
  queue[index] = {
    ...queue[index],
    done: false,
    uploadedAt: "",
    url: "",
    error: "",
  };
  saveQueue(queue);
  return getAppState();
});

ipcMain.handle("queue:remove", (_event, id) => {
  const queue = readQueue().filter((item) => String(item.id) !== String(id));
  saveQueue(queue);
  return getAppState();
});

ipcMain.handle("dialog:select-video", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chon video",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v"] },
      { name: "All files", extensions: ["*"] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle("dialog:select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Chon thu muc video",
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("folder:scan", (_event, { folderPath, account, visibility }) => {
  const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];
  if (!fs.existsSync(folderPath)) throw new Error("Thu muc khong ton tai: " + folderPath);

  const files = fs.readdirSync(folderPath).filter(f =>
    VIDEO_EXTS.includes(path.extname(f).toLowerCase())
  );

  const queue = readQueue();
  const existingSources = new Set(queue.map(item => item.source));
  let added = 0;

  for (const fileName of files) {
    const absolutePath = path.join(folderPath, fileName);
    if (existingSources.has(absolutePath)) continue; // skip duplicates

    const baseName = path.parse(fileName).name;
    // load optional side-car JSON for metadata
    let meta = {};
    const metaPath = path.join(folderPath, baseName + ".json");
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch (_) {}
    }

    const item = {
      id: getNextId(queue),
      account: account || accountConfig.defaultAccount,
      source_type: "local",
      source: absolutePath,
      title: (meta.title || baseName).slice(0, 100),
      description: meta.description || "",
      visibility: visibility || "private",
      madeForKids: Boolean(meta.madeForKids),
      done: false,
      uploadedAt: "",
      url: "",
      error: "",
    };
    queue.push(item);
    existingSources.add(absolutePath);
    added++;
  }

  if (added > 0) saveQueue(queue);
  return { added, total: files.length, state: getAppState() };
});

ipcMain.handle("job:start", (_event, options = {}) => {
  if (activeJob) throw new Error("Dang co job reup dang chay.");

  const nodePath = process.env.npm_node_execpath || "node";
  const account = String(options.account || accountConfig.defaultAccount || "acc1");
  if (!accountConfig.accounts[account]) throw new Error(`Account khong ton tai: ${account}`);

  const visibility = String(options.visibility || "public").toLowerCase();
  if (!["private", "unlisted", "public"].includes(visibility)) {
    throw new Error("Visibility chi nhan private, unlisted hoac public.");
  }

  const childArgs = [
    reupScriptPath,
    "--account",
    account,
    "--visibility",
    visibility,
  ];

  if (options.folder) {
    childArgs.push("--folder", String(options.folder));
  }

  const child = spawn(nodePath, childArgs, {
    cwd: rootDir,
    env: process.env,
    windowsHide: true,
  });

  activeJob = child;
  const logMessage = options.folder
    ? `[app] Scanning ${options.folder} then starting reup job pid=${child.pid}\n`
    : `[app] Starting reup job pid=${child.pid}\n`;
  sendToRenderer("job:log", logMessage);
  sendToRenderer("app:state", getAppState());

  child.stdout.on("data", (chunk) => {
    sendToRenderer("job:log", chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    sendToRenderer("job:log", chunk.toString());
  });
  child.on("error", (error) => {
    sendToRenderer("job:log", `[app] ${error.message}\n`);
  });
  child.on("close", (code, signal) => {
    activeJob = null;
    sendToRenderer("job:log", `[app] Job finished code=${code} signal=${signal || ""}\n`);
    sendToRenderer("job:exit", { code, signal });
    sendToRenderer("app:state", getAppState());
  });

  return getAppState();
});

ipcMain.handle("job:stop", () => {
  if (!activeJob) return getAppState();
  activeJob.kill();
  return getAppState();
});

function getHidemiumAccount(accountName) {
  const name = accountName || accountConfig.defaultAccount;
  const account = accountConfig.accounts[name];
  if (!account) throw new Error(`Account khong ton tai: ${name}`);
  return account;
}

async function runHidemiumAction(actionName, accountName, action) {
  const account = getHidemiumAccount(accountName);
  const payload = {
    action: actionName,
    account: account.name,
    uuid: account.hidemiumUuid || account.uuid || account.profileUuid || "",
    at: new Date().toISOString(),
  };

  sendToRenderer("hidemium:event", {
    ...payload,
    status: "start",
  });

  try {
    const result = await action(account);
    sendToRenderer("hidemium:event", {
      ...payload,
      status: "success",
      result,
      at: new Date().toISOString(),
    });
    return result;
  } catch (error) {
    sendToRenderer("hidemium:event", {
      ...payload,
      status: "error",
      error: error.message,
      at: new Date().toISOString(),
    });
    throw error;
  }
}

ipcMain.handle("hidemium:check", async (_event, accountName) => {
  return runHidemiumAction("check", accountName, (account) =>
    hidemiumApi.checkProfile(account),
  );
});

ipcMain.handle("hidemium:open-profile", async (_event, accountName) => {
  return runHidemiumAction("open-profile", accountName, (account) =>
    hidemiumApi.openProfile(account),
  );
});

ipcMain.handle("hidemium:close-profile", async (_event, accountName) => {
  return runHidemiumAction("close-profile", accountName, (account) =>
    hidemiumApi.closeProfile(account),
  );
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (activeJob) activeJob.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
