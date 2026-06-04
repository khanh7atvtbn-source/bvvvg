const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  defaultAccount: "acc1",
  accounts: {
    acc1: {
      name: "acc1",
      hidemiumUuid:
        process.env.HIDEMIUM_ACC1_UUID ||
        "2234fb99-7260-4e82-af23-78f85ca62bc3",
      profileDir: path.join(rootDir, "accounts", "acc1", "chrome-profile"),
    },
    acc2: {
      name: "acc2",
      hidemiumUuid:
        process.env.HIDEMIUM_ACC2_UUID ||
        "223adfe6-90fa-478c-8212-4030cb23413f",
      profileDir: path.join(rootDir, "accounts", "acc2", "chrome-profile"),
    },
    acc3: {
      name: "acc3",
      hidemiumUuid:
        process.env.HIDEMIUM_ACC3_UUID ||
        "223094d4-a8b4-4315-a45f-89cc498a2aa5",
      profileDir: path.join(rootDir, "accounts", "acc3", "chrome-profile"),
    },
    youtube: {
      name: "youtube",
      hidemiumUuid: process.env.HIDEMIUM_YOUTUBE_UUID || "",
      profileDir: path.join(rootDir, "profiles", "youtube-profile"),
    },
  },
};
