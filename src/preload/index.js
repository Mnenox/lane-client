const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lane', {
  invoke: (type, payload) => ipcRenderer.invoke('api', type, payload),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  getPathForFile: (file) => webUtils.getPathForFile(file)
});