// preload.js - expose a safe API to the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Open folder selection dialog (main process implementation already exists)
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Start uploading videos from the selected folder
  startUpload: (folderPath) => ipcRenderer.invoke('start-upload', folderPath),

  // Receive progress updates from main process
  onProgress: (callback) => ipcRenderer.on('upload-progress', (event, data) => callback(data)),

  // Receive log messages (optional)
  onLog: (callback) => ipcRenderer.on('upload-log', (event, msg) => callback(msg)),
});
