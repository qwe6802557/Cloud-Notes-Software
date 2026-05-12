const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron
    }
});
