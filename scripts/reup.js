const fs = require("fs");
const path = require("path");
const config = require("../config/config");
const accountConfig = require("../config/accounts");
const ytdlp = require("yt-dlp-exec");
const {
  getAccount,
  normalizeVideo,
  readJson,
  uploadVideo,
  writeJson,
} = require("./upload");

// --- CẤU HÌNH SỐ LUỒNG CHẠY SONG SONG ---
// Thay đổi số này tùy thuộc vào cấu hình máy tính của bạn (Khuyến nghị: 2 - 4)
const MAX_CONCURRENT = 3;

// Directory paths
const rootDir = config.rootDir;
const downloadDir = path.join(rootDir, "data", "downloaded");
const queuePath = path.join(rootDir, "data", "reup-queue.json");
const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"];

// Ensure download directory exists
fs.mkdirSync(downloadDir, { recursive: true });

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUploaded(item) {
  return Boolean(item.done || (item.url && !item.error));
}

function shouldProcess(item) {
  return !isUploaded(item) && !item.error;
}

function getCooldownSeconds() {
  const cooldown = Number(config.reup_cooldown);
  return Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 10;
}

function getNextId(queue) {
  return (
    queue.reduce((max, item) => {
      const id = Number(item.id);
      return Number.isFinite(id) ? Math.max(max, id) : max;
    }, 0) + 1
  );
}

function isVideoFile(fileName) {
  return VIDEO_EXTS.includes(path.extname(fileName).toLowerCase());
}

function isUrlSource(source) {
  return /^https?:\/\//i.test(String(source || ""));
}

// Hàm cập nhật trạng thái của 1 item vào file queue một cách an toàn
// Tránh việc các luồng ghi đè đè lên nhau gây lỗi file JSON
function updateQueueItem(itemId, updatedFields) {
  try {
    const currentQueue = readJson(queuePath, []);
    const itemIndex = currentQueue.findIndex((i) => i.id === itemId);
    if (itemIndex !== -1) {
      currentQueue[itemIndex] = {
        ...currentQueue[itemIndex],
        ...updatedFields,
      };
      writeJson(queuePath, currentQueue);
    }
  } catch (err) {
    console.error(
      `[SYSTEM ERROR] Không thể cập nhật queue cho ID ${itemId}:`,
      err.message,
    );
  }
}

function scanFolderIntoQueue(queue, options) {
  const folderPath = path.isAbsolute(options.folder)
    ? options.folder
    : path.resolve(rootDir, options.folder);

  if (!fs.existsSync(folderPath)) {
    throw new Error(`Folder khong ton tai: ${folderPath}`);
  }

  const files = fs
    .readdirSync(folderPath)
    .filter(isVideoFile)
    .map((fileName) => path.join(folderPath, fileName));

  const existingSources = new Set(queue.map((item) => item.source));
  const account = String(
    options.account || accountConfig.defaultAccount || "acc1",
  );
  const visibility = String(options.visibility || "private").toLowerCase();
  const limit = options.limit ? Number(options.limit) : files.length;
  let added = 0;
  let skipped = 0;

  for (const filePath of files) {
    if (added >= limit) break;
    if (!options.force && existingSources.has(filePath)) {
      skipped += 1;
      continue;
    }

    const baseName = path.parse(filePath).name;
    const metaPath = path.join(path.dirname(filePath), `${baseName}.json`);
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try {
        meta = readJson(metaPath, {});
      } catch (_) {
        meta = {};
      }
    }

    queue.push({
      id: getNextId(queue),
      account,
      source_type: "local",
      source: filePath,
      title: String(meta.title || baseName).slice(0, 100),
      description: String(meta.description || ""),
      visibility,
      madeForKids: Boolean(meta.madeForKids),
      done: false,
      uploadedAt: "",
      url: "",
      error: "",
    });
    existingSources.add(filePath);
    added += 1;
  }

  if (added > 0) writeJson(queuePath, queue);
  console.log(
    `Scanned folder: ${folderPath}. Added ${added}, skipped ${skipped}, found ${files.length} video file(s).`,
  );
}

// --- HÀM XỬ LÝ RIÊNG BIỆT CHO TỪNG VIDEO (ĐÃ SỬA LỖI ĐƯỜNG DẪN) ---
async function processSingleVideo(item, index) {
  console.log(
    `\n[THREAD START] Khởi chạy xử lý Video [ID: ${item.id || index}] (Type gốc: ${item.source_type})`,
  );
  console.log(`Source: ${item.source}`);

  let videoPath = null;
  let downloadedFile = null;

  // Tự động kiểm tra thực tế xem nguồn là URL hay File Local
  const thựcSựLàUrl = isUrlSource(item.source);

  try {
    // 1. Prepare video file
    if (thựcSựLàUrl) {
      console.log(`[ID: ${item.id}] Đang tải video từ URL...`);
      const filesBefore = fs.readdirSync(downloadDir);
      const timestamp = Math.floor(Date.now() / 1000);
      const outputPattern = path.join(
        downloadDir,
        `reup_${timestamp}_${item.id || index}_%(id)s.%(ext)s`,
      );

      await ytdlp(item.source, {
        output: outputPattern,
        quiet: true,
        noWarnings: true,
        format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        mergeOutputFormat: "mp4",
      });

      const filesAfter = fs.readdirSync(downloadDir);
      const newFiles = filesAfter
        .filter((f) => !filesBefore.includes(f))
        .filter(isVideoFile);

      if (newFiles.length === 0) {
        throw new Error(
          "Download finished but could not find any downloaded video file. (Note: ffmpeg might be missing).",
        );
      }

      downloadedFile = path.join(downloadDir, newFiles[0]);
      videoPath = downloadedFile;
      console.log(`[ID: ${item.id}] Tải thành công: ${downloadedFile}`);
    } else {
      // Nếu không phải URL mạng, tự động ép xử lý theo kiểu Local File
      console.log(
        `[ID: ${item.id}] Phát hiện đây là File Local. Bỏ qua bước tải URL.`,
      );
      videoPath = path.isAbsolute(item.source)
        ? item.source
        : path.resolve(rootDir, item.source);

      if (!fs.existsSync(videoPath)) {
        throw new Error(`Local video file not found: ${videoPath}`);
      }
    }

    // 2. Fetch Hidemium account details
    const accountName = item.account || "acc1";
    const { account } = getAccount(accountName);

    // 3. Normalize video options
    const videoInput = {
      ...item,
      filePath: videoPath,
      privacy: item.visibility || item.privacy || "private",
    };

    const normalizedVideo = normalizeVideo(videoInput);

    if (normalizedVideo.title) {
      normalizedVideo.title = normalizedVideo.title.substring(0, 100);
    }

    console.log(
      `[ID: ${item.id}] Đang upload lên YouTube qua Hidemium [Account: ${accountName}, Profile UUID: ${account.hidemiumUuid}]`,
    );

    // 4. Trigger upload
    if (config.autoUploadAfterDownload === false) {
      console.log(
        `[ID: ${item.id}] Auto‑upload after download disabled; bỏ qua upload.`,
      );
    } else {
      const result = await uploadVideo({
        accountName,
        account,
        video: normalizedVideo,
        keepOpen: false,
      });

      // 5. Update queue status thành công
      const uploadedAt = new Date().toISOString();
      const url = result && result.url ? result.url : "";

      updateQueueItem(item.id, {
        done: true,
        uploadedAt,
        url,
        error: "",
      });

      console.log(`[SUCCESS] Video [ID: ${item.id}] ĐÃ UPLOAD THÀNH CÔNG!`);

      // Clean up file tạm nếu có tải từ URL về
      if (downloadedFile && fs.existsSync(downloadedFile)) {
        try {
          fs.unlinkSync(downloadedFile);
          console.log(`[ID: ${item.id}] Đã xóa file tạm: ${downloadedFile}`);
        } catch (err) {
          console.warn(
            `[WARNING] Không thể xóa file tạm ${downloadedFile}: ${err.message}`,
          );
        }
      }
    }
  } catch (error) {
    console.error(
      `[FAILED] Lỗi khi xử lý Video [ID: ${item.id}]:`,
      error.message,
    );

    // Cập nhật trạng thái lỗi vào queue
    updateQueueItem(item.id, { error: error.message });

    // Cleanup file tạm nếu lỗi
    if (downloadedFile && fs.existsSync(downloadedFile)) {
      try {
        fs.unlinkSync(downloadedFile);
      } catch (_) {}
    }
  }
}

async function main() {
  console.log(
    "=== STARTING NODE.JS YOUTUBE AUTO REUP SYSTEM (MULTI-THREADING) ===",
  );
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(queuePath)) {
    console.error(
      `Queue file not found at ${queuePath}. Creating a blank one.`,
    );
    writeJson(queuePath, []);
    return;
  }

  let queue = readJson(queuePath, []);
  if (args.folder) {
    scanFolderIntoQueue(queue, args);
    queue = readJson(queuePath, []); // Đọc lại sau khi scan folder
  }

  let normalizedExistingUploads = false;
  for (const item of queue) {
    if (!item.done && item.url && !item.error) {
      item.done = true;
      normalizedExistingUploads = true;
    }
  }
  if (normalizedExistingUploads) {
    writeJson(queuePath, queue);
  }

  const pending = queue.filter(shouldProcess);

  if (pending.length === 0) {
    console.log("No pending video items in the queue.");
    const skippedErrors = queue.filter(
      (item) => !isUploaded(item) && item.error,
    );
    if (skippedErrors.length > 0) {
      console.log(`Skipped ${skippedErrors.length} errored item(s).`);
    }
    return;
  }

  console.log(`Found ${pending.length} pending videos trong queue.`);
  console.log(
    `Hệ thống cấu hình chạy song song tối đa: ${MAX_CONCURRENT} luồng.\n`,
  );

  // --- THUẬT TOÁN ĐIỀU PHỐI ĐA LUỒNG (POOL POINTER) ---
  let poolIndex = 0;

  // Hàm này đại diện cho 1 "Worker" (Luồng làm việc)
  // Worker này cứ làm xong 1 video sẽ tự động nhặt video tiếp theo trong danh sách để làm tiếp
  async function worker() {
    while (poolIndex < pending.length) {
      const currentIndex = poolIndex;
      poolIndex += 1; // Tăng index lên để luồng khác không bị trùng việc

      const item = pending[currentIndex];
      await processSingleVideo(item, currentIndex);

      // Cooldown riêng cho mỗi luồng nếu vẫn còn video trong hàng đợi
      if (poolIndex < pending.length) {
        const cooldown = getCooldownSeconds();
        console.log(
          `[Luồng] Đang nghỉ ${cooldown} giây trước khi nhận video mới...`,
        );
        await sleep(cooldown * 1000);
      }
    }
  }

  // Khởi tạo số lượng luồng chạy đồng thời dựa trên cấu hình MAX_CONCURRENT
  const workers = [];
  const activeThreads = Math.min(MAX_CONCURRENT, pending.length);

  for (let i = 0; i < activeThreads; i++) {
    workers.push(worker());
  }

  // Chờ cho tất cả các luồng hoàn thành toàn bộ công việc
  await Promise.all(workers);

  console.log("\n=== AUTO REUP PROCESS COMPLETED ===");
}

main().catch((error) => {
  console.error("Fatal error in reup script:", error);
  process.exitCode = 1;
});
