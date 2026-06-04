const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  rootDir,
  browser: {
    provider: process.env.BROWSER_PROVIDER || "hidemium",
    headless: false,
    slowMo: 80,
    channel: "chrome",
    viewport: { width: 1366, height: 900 },
    timeout: 30000,
  },
  hidemium: {
    apiUrl: process.env.HIDEMIUM_API_URL || "",
    closeProfileWhenDone: process.env.HIDEMIUM_CLOSE_WHEN_DONE !== "false",
    command: process.env.HIDEMIUM_COMMAND || "",
  },
  timeouts: {
    default: 30000,
    navigation: 60000,
    upload: 45 * 60 * 1000,
  },
  uploadDefaults: {
    madeForKids: false,
    privacy: "private",
    publish: true,
    closeBrowserWhenDone: true,
  },
  reup_cooldown: process.env.REUP_COOLDOWN
    ? Number(process.env.REUP_COOLDOWN)
    : 10,
  batch: {
    folder: process.env.VIDEO_BATCH_DIR || "videos",
    thumbnailExtensions: [".jpg", ".png"],
    // Optional cooldown between batch uploads (seconds)
    cooldown: process.env.BATCH_COOLDOWN ? Number(process.env.BATCH_COOLDOWN) : 180,
  },
  // New flag to control auto‑upload after a download completes
  autoUploadAfterDownload: process.env.AUTO_UPLOAD_AFTER_DOWNLOAD !== "false",
  paths: {
    video: path.join(rootDir, "data", "video.json"),
    queue: path.join(rootDir, "data", "queue.json"),
    uploaded: path.join(rootDir, "data", "uploaded.json"),
    logs: path.join(rootDir, "logs"),
    batchUploaded: path.join(rootDir, "data", "batch-uploaded.json"),
  },
};
