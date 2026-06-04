const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const queuePath = path.join(rootDir, "data", "reup-queue.json");
const videoDir = path.join(rootDir, "accounts", "acc1", "videos");

const metadata = {
  "Download (1).mp4": {
    title: "Khoanh khac giai tri ngan #1",
    description:
      "Video giai tri ngan, xem nhanh va thu gian moi ngay.\n\n#shorts #giaitri #reup",
  },
  "Download (2).mp4": {
    title: "Tinh huong hai huoc bat ngo #2",
    description:
      "Mot khoanh khac vui nhon de ban thu gian trong ngay.\n\n#shorts #haihuoc #giaitri",
  },
  "Download (3).mp4": {
    title: "Clip ngan dang xem #3",
    description:
      "Noi dung ngan gon, de xem, phu hop dang YouTube Shorts.\n\n#shorts #viral #clipngan",
  },
  "Download (4).mp4": {
    title: "Pha xu ly bat ngo #4",
    description:
      "Tong hop khoanh khac thu vi va bat ngo danh cho Shorts.\n\n#shorts #xuhuong #giaitri",
  },
  "Download (6).mp4": {
    title: "Video ngan thu vi #6",
    description:
      "Clip ngan giai tri, dang cong khai tu dong bang tool reup.\n\n#shorts #video #giaitri",
  },
  "Download (7).mp4": {
    title: "Khoanh khac vui nhon #7",
    description:
      "Video ngan vui nhon, xem nhanh va chia se neu thay hay.\n\n#shorts #funny #giaitri",
  },
  "Download.mp4": {
    title: "Clip giai tri moi nhat",
    description:
      "Video giai tri ngan moi duoc them vao thu muc acc1.\n\n#shorts #giaitri #moi",
  },
  "test1.mp4": {
    title: "Video test reup acc1 #1",
    description:
      "Video kiem tra luong auto reup cho account acc1.\n\n#shorts #test #reup",
  },
  "test2.mp4": {
    title: "Video test reup acc1 #2",
    description:
      "Kiem tra upload tu dong len YouTube bang Hidemium va Playwright.\n\n#shorts #automation #reup",
  },
  "test3.mp4": {
    title: "Video test reup acc1 #3",
    description:
      "Noi dung test trong thu muc acc1/videos cho auto reup.\n\n#shorts #test #youtube",
  },
  "test4.mp4": {
    title: "Video test reup acc1 #4",
    description:
      "Video dung de kiem tra queue va upload tu dong.\n\n#shorts #reup #youtube",
  },
  "test5.mp4": {
    title: "Video test reup acc1 #5",
    description:
      "Kiem tra title, mo ta va trang thai upload cua acc1.\n\n#shorts #automation #test",
  },
};

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  return raw ? JSON.parse(raw) : fallback;
}

function normalized(value) {
  return path.normalize(String(value || "")).toLowerCase();
}

function isAcc1Video(source) {
  return normalized(source).startsWith(`${normalized(videoDir)}${path.sep}`);
}

const queue = readJson(queuePath, []);
const seenSources = new Set();
let updated = 0;
let removedDuplicates = 0;

const nextQueue = queue.filter((item) => {
  const source = String(item.source || "");
  if (!isAcc1Video(source)) return true;

  if (item.source_type === "url" && !/^https?:\/\//i.test(source)) {
    removedDuplicates += 1;
    return false;
  }

  const sourceKey = normalized(source);
  if (seenSources.has(sourceKey)) {
    removedDuplicates += 1;
    return false;
  }
  seenSources.add(sourceKey);

  const info = metadata[path.basename(source)];
  if (info) {
    item.account = "acc1";
    item.source_type = "local";
    item.title = info.title.slice(0, 100);
    item.description = info.description;
    item.visibility = item.visibility || "public";
    updated += 1;
  }
  return true;
});

fs.writeFileSync(queuePath, `${JSON.stringify(nextQueue, null, 2)}\n`);

let sidecars = 0;
for (const [fileName, info] of Object.entries(metadata)) {
  const videoPath = path.join(videoDir, fileName);
  if (!fs.existsSync(videoPath)) continue;

  const metaPath = path.join(videoDir, `${path.parse(fileName).name}.json`);
  fs.writeFileSync(
    metaPath,
    `${JSON.stringify({ ...info, madeForKids: false }, null, 2)}\n`,
  );
  sidecars += 1;
}

console.log(
  `Updated ${updated} queue item(s), removed ${removedDuplicates} duplicate/bad item(s), wrote ${sidecars} metadata file(s).`,
);
