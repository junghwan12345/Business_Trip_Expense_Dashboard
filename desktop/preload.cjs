const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  selectDirectory: (options = {}) => ipcRenderer.invoke("desktop:select-directory", options),
  getAppInfo: () => ipcRenderer.invoke("desktop:app-info"),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:update-status"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  onUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("desktop:update-status-changed", handler);
    return () => ipcRenderer.removeListener("desktop:update-status-changed", handler);
  }
});
