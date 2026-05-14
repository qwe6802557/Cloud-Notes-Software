const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const isDev = !app.isPackaged;
const devServerUrl = 'http://localhost:3000';
const appBuildPath = path.join(__dirname, '../build');
const appEntryUrl = isDev
    ? devServerUrl
    : pathToFileURL(path.join(appBuildPath, 'index.html')).toString();

let mainWindow = null;

const sanitizeFileName = fileName => {
    return (fileName || 'note')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
};

const isInsideAppBuildPath = targetPath => {
    const relativePath = path.relative(appBuildPath, targetPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
};

const isAllowedNavigation = targetUrl => {
    try {
        const parsedUrl = new URL(targetUrl);
        if (isDev) {
            return parsedUrl.origin === new URL(devServerUrl).origin;
        }
        return parsedUrl.protocol === 'file:' && isInsideAppBuildPath(fileURLToPath(parsedUrl));
    } catch (error) {
        return false;
    }
};

const isSafeExternalUrl = targetUrl => {
    try {
        const parsedUrl = new URL(targetUrl);
        return ['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol);
    } catch (error) {
        return false;
    }
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    mainWindow.loadURL(appEntryUrl);

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) {
            shell.openExternal(url);
        }

        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
        if (isAllowedNavigation(navigationUrl)) {
            return;
        }

        event.preventDefault();
        if (isSafeExternalUrl(navigationUrl)) {
            shell.openExternal(navigationUrl);
        }
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

ipcMain.handle('dialog:saveMarkdownFile', async (event, payload = {}) => {
    const { content = '', suggestedName = 'note.md' } = payload;
    const defaultFileName = sanitizeFileName(suggestedName).endsWith('.md')
        ? sanitizeFileName(suggestedName)
        : `${sanitizeFileName(suggestedName)}.md`;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出 Markdown',
        defaultPath: defaultFileName,
        filters: [
            {
                name: 'Markdown',
                extensions: ['md']
            }
        ]
    });

    if (result.canceled || !result.filePath) {
        return {
            canceled: true
        };
    }

    await fs.promises.writeFile(result.filePath, content, 'utf-8');

    return {
        canceled: false,
        filePath: result.filePath
    };
});

ipcMain.handle('dialog:saveHtmlFile', async (event, payload = {}) => {
    const { content = '', suggestedName = 'note.html' } = payload;
    const defaultFileName = sanitizeFileName(suggestedName).endsWith('.html')
        ? sanitizeFileName(suggestedName)
        : `${sanitizeFileName(suggestedName)}.html`;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出 HTML',
        defaultPath: defaultFileName,
        filters: [
            {
                name: 'HTML',
                extensions: ['html']
            }
        ]
    });

    if (result.canceled || !result.filePath) {
        return {
            canceled: true
        };
    }

    await fs.promises.writeFile(result.filePath, content, 'utf-8');

    return {
        canceled: false,
        filePath: result.filePath
    };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
