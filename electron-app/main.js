// main.js - Electron main process
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { getAccount, uploadVideo, normalizeVideo } = require('../scripts/upload');

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#1E1E1E',
    show: false,
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Open devtools in dev mode
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers – placeholder for future actions
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

// Start upload handler – scans folder, uploads videos sequentially, reports progress
ipcMain.handle('start-upload', async (event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    throw new Error('Folder path is invalid');
  }
  const files = fs.readdirSync(folderPath);
  const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov'];
  const videos = files.filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));
  const { accountName, account } = getAccount(); // default account
  const results = [];
  for (const fileName of videos) {
    const absolutePath = path.join(folderPath, fileName);
    const baseName = path.parse(fileName).name;
    // Load side‑car JSON if exists
    let meta = {};
    const metaPath = path.join(folderPath, `${baseName}.json`);
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) {}
    }
    const videoInput = { ...meta, filePath: absolutePath, title: meta.title || baseName };
    const video = normalizeVideo(videoInput);
    // Notify renderer about start
    event.sender.send('upload-progress', { file: fileName, status: 'uploading' });
    try {
      const result = await uploadVideo({ accountName, account, video, keepOpen: false });
      results.push(result);
      event.sender.send('upload-progress', { file: fileName, status: 'done', url: result.url });
    } catch (err) {
      event.sender.send('upload-progress', { file: fileName, status: 'error', error: err.message });
    }
  }
  return results;
});
