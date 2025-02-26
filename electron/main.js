// 引入所需的 Electron 模块
const { app, BrowserWindow } = require('electron'); // app 控制应用程序的事件生命周期，BrowserWindow 创建和管理应用窗口
const path = require('path'); // Node.js 的 path 模块，用于处理文件路径

// 直接检查开发环境
const isDev = !app.isPackaged;

// 创建应用窗口的函数
function createWindow() {
    // 创建一个新的浏览器窗口
    const mainWindow = new BrowserWindow({
        width: 1200,  // 窗口宽度
        height: 800, // 窗口高度
        webPreferences: {
            nodeIntegration: true,     // 启用 Node.js 集成
            contextIsolation: false    // 禁用上下文隔离，允许渲染进程访问 Node.js API
        }
    });

    // 根据开发环境或生产环境加载不同的应用内容
    mainWindow.loadURL(
        isDev
            ? 'http://localhost:3000'  // 开发环境下：加载开发服务器地址
            : `file://${path.join(__dirname, '../build/index.html')}` // 生产环境下：加载打包后的 HTML 文件
    );

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
