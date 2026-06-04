const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("reupApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  addQueueItem: (item) => ipcRenderer.invoke("queue:add", item),
  updateQueueItem: (id, item) => ipcRenderer.invoke("queue:update", id, item),
  retryQueueItem: (id) => ipcRenderer.invoke("queue:retry", id),
  removeQueueItem: (id) => ipcRenderer.invoke("queue:remove", id),
  selectVideo: () => ipcRenderer.invoke("dialog:select-video"),
  selectFolder: () => ipcRenderer.invoke("dialog:select-folder"),
  scanFolder: (opts) => ipcRenderer.invoke("folder:scan", opts),
  startJob: (opts) => ipcRenderer.invoke("job:start", opts),
  stopJob: () => ipcRenderer.invoke("job:stop"),
  checkHidemium: (accountName) => ipcRenderer.invoke("hidemium:check", accountName),
  openHidemiumProfile: (accountName) =>
    ipcRenderer.invoke("hidemium:open-profile", accountName),
  closeHidemiumProfile: (accountName) =>
    ipcRenderer.invoke("hidemium:close-profile", accountName),
  onState: (callback) => {
    ipcRenderer.on("app:state", (_event, state) => callback(state));
  },
  onJobLog: (callback) => {
    ipcRenderer.on("job:log", (_event, line) => callback(line));
  },
  onJobExit: (callback) => {
    ipcRenderer.on("job:exit", (_event, result) => callback(result));
  },
  onHidemiumEvent: (callback) => {
    ipcRenderer.on("hidemium:event", (_event, payload) => callback(payload));
  },
});
