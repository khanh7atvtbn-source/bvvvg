const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  defaultAccount: "acc1",
  accounts: {
    acc1: {
      name: "acc1",
      profileDir: path.join(rootDir, "accounts", "acc1", "chrome-profile"),
    },
    acc2: {
      name: "acc2",
      profileDir: path.join(rootDir, "accounts", "acc2", "chrome-profile"),
    },
    acc3: {
      name: "acc3",
      profileDir: path.join(rootDir, "accounts", "acc3", "chrome-profile"),
    },
    youtube: {
      name: "youtube",
      profileDir: path.join(rootDir, "profiles", "youtube-profile"),
    },
  },
};
