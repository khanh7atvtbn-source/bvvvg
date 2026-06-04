const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const { getAccount, normalizeVideo, uploadVideo, readJson, writeJson } = require('./upload');

// Resolve the batch folder (relative to project root)
const batchFolder = path.isAbsolute(config.batch.folder)
  ? config.batch.folder
  : path.resolve(config.rootDir, config.batch.folder);

// If auto upload after download is disabled, exit early
if (config.autoUploadAfterDownload === false) {
  console.log('Auto-upload after download is disabled via config. Exiting.');
  process.exit(0);
}

// Helper: list all video files (common extensions)
const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov'];
function isVideoFile(filename) {
  return VIDEO_EXTS.includes(path.extname(filename).toLowerCase());
}

// Load existing uploaded results to avoid duplicates
const uploadedLogPath = config.paths.batchUploaded;
let uploadedLog = [];
if (fs.existsSync(uploadedLogPath)) {
  try { uploadedLog = readJson(uploadedLogPath, []); } catch (_) { uploadedLog = []; }
}

async function main() {
  console.log('=== STARTING BATCH AUTO‑UPLOAD ===');
  console.log(`Scanning folder: ${batchFolder}`);

  if (!fs.existsSync(batchFolder)) {
    console.error(`Batch folder does not exist: ${batchFolder}`);
    return;
  }

  const files = fs.readdirSync(batchFolder);
  const videos = files.filter(isVideoFile);
  if (videos.length === 0) {
    console.log('No video files found in batch folder.');
    return;
  }

  for (const fileName of videos) {
    const absoluteVideoPath = path.join(batchFolder, fileName);
    const baseName = path.parse(fileName).name;

    // Skip if already uploaded (based on file path)
    if (uploadedLog.find((item) => item.filePath === absoluteVideoPath)) {
      console.log(`Skipping already uploaded video: ${fileName}`);
      continue;
    }

    // ---- 1. Load per‑file metadata (optional JSON side‑car) ----
    let meta = {};
    const metaPath = path.join(batchFolder, `${baseName}.json`);
    if (fs.existsSync(metaPath)) {
      try { meta = readJson(metaPath, {}); }
      catch (e) { console.warn(`Failed to read metadata ${metaPath}: ${e.message}`); }
    }

    // ---- 2. Determine thumbnail (optional) ----
    let thumbnailPath = null;
    for (const ext of config.batch.thumbnailExtensions) {
      const candidate = path.join(batchFolder, `${baseName}${ext}`);
      if (fs.existsSync(candidate)) { thumbnailPath = candidate; break; }
    }
    if (thumbnailPath) meta.thumbnailPath = thumbnailPath;

    // ---- 3. Build video object for upload ----
    const videoInput = {
      ...meta,
      filePath: absoluteVideoPath,
      title: meta.title || baseName,
    };
    const video = normalizeVideo(videoInput);

    // ---- 4. Choose account (default) ----
    const { accountName, account } = getAccount(); // uses defaultAccount from accounts config

    console.log(`\nUploading ${fileName} via account ${accountName}`);
    try {
      const result = await uploadVideo({
        accountName,
        account,
        video,
        keepOpen: false,
      });

      // ---- 5. Record result ----
      uploadedLog.push({
        filePath: absoluteVideoPath,
        title: result.title,
        url: result.url,
        uploadedAt: result.uploadedAt,
        account: accountName,
      });
      writeJson(uploadedLogPath, uploadedLog);

      console.log(`[SUCCESS] Uploaded ${fileName} → ${result.url || 'no URL'}`);
    } catch (err) {
      console.error(`[FAILED] Upload of ${fileName} error: ${err.message}`);
    }

    // ---- 6. Cooldown before next upload ----
    const cooldownSec = config.batch.cooldown || 180;
    console.log(`Waiting ${cooldownSec}s before next video...`);
    await new Promise((r) => setTimeout(r, cooldownSec * 1000));
  }

  console.log('\n=== BATCH AUTO‑UPLOAD COMPLETED ===');
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal error in batch script:', e);
    process.exitCode = 1;
  });
}
