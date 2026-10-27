const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    versions: {
        chrome: process.versions.chrome,
        electron: process.versions.electron
    },
    saveMarkdownFile: payload => ipcRenderer.invoke('dialog:saveMarkdownFile', payload),
    saveHtmlFile: payload => ipcRenderer.invoke('dialog:saveHtmlFile', payload),
    windowControl: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
        onMaximizedChange: callback => {
            const listener = (_event, isMaximized) => callback(isMaximized);
            ipcRenderer.on('window:maximized-change', listener);
            return () => ipcRenderer.removeListener('window:maximized-change', listener);
        }
    },
    tray: {
        onQuickNewNote: callback => {
            const listener = () => callback();
            ipcRenderer.on('shortcut:quick-new-note', listener);
            return () => ipcRenderer.removeListener('shortcut:quick-new-note', listener);
        },
        onOpenCommandPalette: callback => {
            const listener = () => callback();
            ipcRenderer.on('shortcut:open-command-palette', listener);
            return () => ipcRenderer.removeListener('shortcut:open-command-palette', listener);
        },
        updateSyncStatus: statusData => ipcRenderer.send('tray:sync-status', statusData)
    },
    theme: {
        get: () => ipcRenderer.invoke('theme:get'),
        set: mode => ipcRenderer.invoke('theme:set', mode),
        onThemeChange: callback => {
            const listener = (_event, data) => callback(data);
            ipcRenderer.on('theme:changed', listener);
            return () => ipcRenderer.removeListener('theme:changed', listener);
        }
    },
    updater: {
        check: (isManual = false) => ipcRenderer.invoke('updater:check', isManual),
        download: () => ipcRenderer.invoke('updater:download'),
        install: () => ipcRenderer.invoke('updater:install'),
        onUpdateAvailable: callback => {
            const listener = (_event, info) => callback(info);
            ipcRenderer.on('update:available', listener);
            return () => ipcRenderer.removeListener('update:available', listener);
        },
        onUpdateNotAvailable: callback => {
            const listener = (_event, info) => callback(info);
            ipcRenderer.on('update:not-available', listener);
            return () => ipcRenderer.removeListener('update:not-available', listener);
        },
        onDownloadProgress: callback => {
            const listener = (_event, progress) => callback(progress);
            ipcRenderer.on('update:download-progress', listener);
            return () => ipcRenderer.removeListener('update:download-progress', listener);
        },
        onUpdateDownloaded: callback => {
            const listener = (_event, info) => callback(info);
            ipcRenderer.on('update:downloaded', listener);
            return () => ipcRenderer.removeListener('update:downloaded', listener);
        },
        onError: callback => {
            const listener = (_event, error) => callback(error);
            ipcRenderer.on('update:error', listener);
            return () => ipcRenderer.removeListener('update:error', listener);
        }
    }
});
