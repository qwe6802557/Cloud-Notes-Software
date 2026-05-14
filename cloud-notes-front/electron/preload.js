const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron
    },
    saveMarkdownFile: payload => ipcRenderer.invoke('dialog:saveMarkdownFile', payload),
    saveHtmlFile: payload => ipcRenderer.invoke('dialog:saveHtmlFile', payload)
});
