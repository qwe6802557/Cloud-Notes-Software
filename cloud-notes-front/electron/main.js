// 引入所需的 Electron 模块
const { app, BrowserWindow, shell } = require('electron'); // app 控制应用程序的事件生命周期，BrowserWindow 创建和管理应用窗口
const path = require('path'); // Node.js 的 path 模块，用于处理文件路径
const { fileURLToPath, pathToFileURL } = require('url');

// 直接检查开发环境
const isDev = !app.isPackaged;
const devServerUrl = 'http://localhost:3000';
const appBuildPath = path.join(__dirname, '../build');
const appEntryUrl = isDev
    ? devServerUrl
    : pathToFileURL(path.join(appBuildPath, 'index.html')).toString();

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

// 创建应用窗口的函数
function createWindow() {
    // 创建一个新的浏览器窗口
    const mainWindow = new BrowserWindow({
        width: 1200,  // 窗口宽度
        height: 800, // 窗口高度
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,     // 禁用 Node.js 集成
            contextIsolation: true,    // 启用上下文隔离，避免渲染进程直接访问 Node.js API
            sandbox: true
        }
    });

    // 根据开发环境或生产环境加载不同的应用内容
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

    // 在开发环境中打开开发者工具
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

// Electron 完成初始化时创建窗口
app.whenReady().then(createWindow);

// 监听所有窗口关闭事件
app.on('window-all-closed', () => {
    // 在 macOS 上，除非用户使用 Cmd + Q 确定退出
    // 否则绝大部分应用会保持活动状态
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 监听应用被激活事件
app.on('activate', () => {
    // 在 macOS 上，当单击 dock 图标并且没有其他窗口打开时，
    // 在应用程序中重新创建一个窗口
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
