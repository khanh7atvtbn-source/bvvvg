const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  rootDir,
  browser: {
    headless: false,
    slowMo: 80,
    channel: "chrome",
    viewport: { width: 1366, height: 900 },
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
  paths: {
    video: path.join(rootDir, "data", "video.json"),
    queue: path.join(rootDir, "data", "queue.json"),
    uploaded: path.join(rootDir, "data", "uploaded.json"),
    logs: path.join(rootDir, "logs"),
  },
};
