const { app, BrowserWindow, shell, ipcMain, dialog, screen, Tray, Menu, globalShortcut, nativeImage, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const AppUpdater = require('./updater');
const MirrorService = require('./mirrorService');
const { rewriteApiCorsRequestHeaders, rewriteApiCorsResponseHeaders } = require('./corsHelpers');

const DEFAULT_PROD_API_URL = 'https://notes.yanggenbwebsite.site/api';
const DEFAULT_DEV_API_URL = 'http://localhost:3001/api';

const readPackageMeta = () => {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        return {
            version: pkg.version || '1.0.0',
            buildNumber: Number(pkg.buildNumber) || 1
        };
    } catch {
        return { version: '1.0.0', buildNumber: 1 };
    }
};

const pkgMeta = readPackageMeta();
const isDev = !app.isPackaged;
let distributionMode = 'nsis';

// 便携版数据隔离（必须在 app.whenReady 与单实例锁之前执行）
if (!isDev) {
    const exeDir = path.dirname(process.execPath);
    const portableMarker = path.join(exeDir, '.portable');
    if (fs.existsSync(portableMarker)) {
        try {
            const portableDataDir = path.join(exeDir, 'data');
            fs.mkdirSync(portableDataDir, { recursive: true });
            fs.accessSync(portableDataDir, fs.constants.W_OK);
            app.setPath('userData', portableDataDir);
            distributionMode = 'portable';
        } catch (err) {
            console.warn('[Portable] portable data dir unavailable, fallback to default userData:', err.message);
        }
    }
}

const getApiBaseUrl = () => {
    const raw = (process.env.CLOUD_NOTES_API_URL || '').trim();
    if (raw) return raw.replace(/\/+$/, '');
    return isDev ? DEFAULT_DEV_API_URL : DEFAULT_PROD_API_URL;
};

const getApiOrigin = () => {
    try {
        return new URL(getApiBaseUrl()).origin;
    } catch {
        return 'https://notes.yanggenbwebsite.site';
    }
};

const setupApiCorsOriginRewrite = () => {
    if (!app.isPackaged || !session?.defaultSession?.webRequest) {
        return;
    }
    const apiOrigin = getApiOrigin();
    const filter = { urls: [`${apiOrigin}/*`] };

    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        callback({
            requestHeaders: rewriteApiCorsRequestHeaders(details.requestHeaders, apiOrigin)
        });
    });

    session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
        callback({
            responseHeaders: rewriteApiCorsResponseHeaders(details.responseHeaders, details.initiator)
        });
    });
};

const mirrorService = new MirrorService({
    getUserDataPath: () => app.getPath('userData'),
    dialog,
    shell
});

// 禁用硬件加速与 GPU 沙盒异常拦截，防止 Windows 驱动不匹配触发 Chromium 0x80000003 崩溃
app.disableHardwareAcceleration();

const devServerUrl = 'http://localhost:3000';
const appBuildPath = path.join(__dirname, '../build');
const appEntryUrl = isDev
    ? devServerUrl
    : pathToFileURL(path.join(appBuildPath, 'index.html')).toString();

let mainWindow = null;
let tray = null;
let appUpdater = null;
let isQuitting = false;
let currentSyncStatus = { status: 'synced', queuedCount: 0 };
let saveStateTimer = null;

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
    } catch {
        return false;
    }
};

const isSafeExternalUrl = targetUrl => {
    try {
        const parsedUrl = new URL(targetUrl);
        return ['http:', 'https:', 'mailto:'].includes(parsedUrl.protocol);
    } catch {
        return false;
    }
};

/**
 * 窗口状态持久化与多显示器自愈校准
 */
const getWindowStatePath = () => path.join(app.getPath('userData'), 'window-state.json');

const loadWindowState = () => {
    const defaultState = {
        width: 1200,
        height: 800,
        isMaximized: false
    };

    try {
        const statePath = getWindowStatePath();
        if (!fs.existsSync(statePath)) return defaultState;

        const raw = fs.readFileSync(statePath, 'utf-8');
        const state = JSON.parse(raw);

        if (typeof state.x === 'number' && typeof state.y === 'number') {
            const displays = screen.getAllDisplays();
            const isVisible = displays.some(display => {
                const { x, y, width, height } = display.bounds;
                return (
                    state.x >= x - 20 &&
                    state.x <= x + width - 100 &&
                    state.y >= y - 20 &&
                    state.y <= y + height - 100
                );
            });
            if (!isVisible) {
                delete state.x;
                delete state.y;
            }
        }

        return { ...defaultState, ...state };
    } catch {
        return defaultState;
    }
};

const saveWindowState = () => {
    if (!mainWindow) return;
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => {
        try {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const isMaximized = mainWindow.isMaximized();
            const bounds = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
            const state = {
                ...bounds,
                isMaximized
            };
            fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8');
        } catch {}
    }, 300);
};

const showMainWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    updateTrayMenu();
};

const toggleMainWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
        mainWindow.hide();
    } else {
        showMainWindow();
    }
    updateTrayMenu();
};

/**
 * 托盘图标加载与上下文菜单管理
 */
const getAppIcon = () => {
    const candidates = [
        path.join(__dirname, '../build/favicon.ico'),
        path.join(__dirname, '../build/favicon-32x32.png'),
        path.join(__dirname, '../assets/icon.ico'),
        path.join(__dirname, '../public/favicon.ico'),
        path.join(__dirname, '../public/favicon-32x32.png')
    ];

    for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
            const img = nativeImage.createFromPath(filePath);
            if (!img.isEmpty()) {
                return img;
            }
        }
    }
    return null;
};

const getTrayIcon = () => getAppIcon() || nativeImage.createEmpty();

const getSyncStatusText = () => {
    const count = currentSyncStatus.queuedCount || 0;
    switch (currentSyncStatus.status) {
        case 'syncing':
            return `同步中: 剩余 ${count || 1} 篇...`;
        case 'pending':
            return `本地已存: ${count} 篇待同步`;
        case 'offline':
            return `离线保护中 (待同步: ${count})`;
        case 'conflict':
            return '检测到待裁决内容冲突';
        case 'synced':
        default:
            return '状态: 全部已同步';
    }
};

const updateTrayMenu = () => {
    if (!tray) return;

    const isVisible = mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized();
    const statusText = getSyncStatusText();

    const contextMenu = Menu.buildFromTemplate([
        {
            label: isVisible ? '隐藏窗口' : '显示云笔记',
            click: toggleMainWindow
        },
        {
            label: '新建笔记 (Ctrl+Alt+N)',
            click: () => {
                showMainWindow();
                mainWindow?.webContents.send('shortcut:quick-new-note');
            }
        },
        {
            label: '全局搜索 (Ctrl+Alt+F)',
            click: () => {
                showMainWindow();
                mainWindow?.webContents.send('shortcut:open-command-palette');
            }
        },
        {
            label: '打开随心记 (Ctrl+Alt+M)',
            click: () => {
                showMainWindow();
                mainWindow?.webContents.send('shortcut:open-memo');
            }
        },
        { type: 'separator' },
        {
            label: statusText,
            enabled: false
        },
        { type: 'separator' },
        {
            label: '检查新版本...',
            click: () => {
                showMainWindow();
                appUpdater?.checkForUpdates(true);
            }
        },
        { type: 'separator' },
        {
            label: '退出云笔记',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(`云笔记 - ${statusText}`);
};

const createTray = () => {
    if (tray) return;

    const icon = getTrayIcon();
    tray = new Tray(icon);

    tray.on('click', toggleMainWindow);
    tray.on('double-click', toggleMainWindow);

    updateTrayMenu();
};

/**
 * 全局快捷键注册与容错防冲突
 */
const registerShortcutSafely = (accelerator, handler) => {
    try {
        globalShortcut.register(accelerator, handler);
    } catch (err) {
        console.error(`Failed to register global shortcut ${accelerator}:`, err);
    }
};

const registerGlobalShortcuts = () => {
    registerShortcutSafely('CommandOrControl+Alt+N', () => {
        showMainWindow();
        mainWindow?.webContents.send('shortcut:quick-new-note');
    });

    registerShortcutSafely('CommandOrControl+Alt+F', () => {
        showMainWindow();
        mainWindow?.webContents.send('shortcut:open-command-palette');
    });

    registerShortcutSafely('CommandOrControl+Alt+M', () => {
        showMainWindow();
        mainWindow?.webContents.send('shortcut:open-memo');
    });

    registerShortcutSafely('CommandOrControl+Alt+C', () => {
        toggleMainWindow();
    });
};

function createWindow() {
    const windowState = loadWindowState();
    const windowIcon = getAppIcon();

    mainWindow = new BrowserWindow({
        width: windowState.width,
        height: windowState.height,
        x: windowState.x,
        y: windowState.y,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        ...(windowIcon ? { icon: windowIcon } : {}),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#020617' : '#f8fafc',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    if (windowState.isMaximized) {
        mainWindow.maximize();
    }

    mainWindow.loadURL(appEntryUrl);

    // 初始化自动更新调度器
    appUpdater = new AppUpdater(mainWindow, {
        distribution: distributionMode,
        buildNumber: pkgMeta.buildNumber
    });

    // 启动 5 秒后静默探测新版本
    setTimeout(() => {
        appUpdater?.checkForUpdates(false);
    }, 5000);

    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);

    // 拦截窗口关闭事件，默认隐藏至系统托盘常驻
    mainWindow.on('close', event => {
        if (!isQuitting) {
            event.preventDefault();
            saveWindowState();
            mainWindow.hide();
            updateTrayMenu();
            return false;
        }
        saveWindowState();
    });

    mainWindow.on('maximize', () => {
        saveWindowState();
        mainWindow?.webContents.send('window:maximized-change', true);
    });

    mainWindow.on('unmaximize', () => {
        saveWindowState();
        mainWindow?.webContents.send('window:maximized-change', false);
    });

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

    // 生产环境拦截 Chromium 默认右键菜单，消除浏览器调试残留，由应用渲染层统一接管
    mainWindow.webContents.on('context-menu', event => {
        if (!isDev) {
            event.preventDefault();
        }
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

// 单实例锁互斥：防止多开冲突
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showMainWindow();
    });

    app.whenReady().then(() => {
        setupApiCorsOriginRewrite();
        createWindow();
        createTray();
        registerGlobalShortcuts();
    });

    app.on('before-quit', () => {
        isQuitting = true;
        globalShortcut.unregisterAll();
    });

    app.on('will-quit', () => {
        globalShortcut.unregisterAll();
    });

    app.on('window-all-closed', () => {
        if (process.platform === 'darwin') {
            updateTrayMenu();
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            showMainWindow();
        }
    });
}

// 沉浸式窗口生命周期 IPC 接口
ipcMain.handle('window:minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
    }
});

ipcMain.handle('window:maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.handle('window:close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
});

ipcMain.handle('window:isMaximized', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        return mainWindow.isMaximized();
    }
    return false;
});

// 托盘同步状态更新 IPC 通道
ipcMain.on('tray:sync-status', (_event, payload = {}) => {
    currentSyncStatus = {
        status: payload.status || 'synced',
        queuedCount: typeof payload.queuedCount === 'number' ? payload.queuedCount : 0
    };
    updateTrayMenu();
});


// 监听操作系统或应用主题外观变更，广播至渲染进程
nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('theme:changed', {
            themeSource: nativeTheme.themeSource,
            shouldUseDarkColors: nativeTheme.shouldUseDarkColors
        });
    }
});

// 主题外观感知与设置 IPC
ipcMain.handle('theme:get', () => {
    return {
        themeSource: nativeTheme.themeSource,
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    };
});

ipcMain.handle('theme:set', (_event, mode = 'system') => {
    if (['system', 'light', 'dark'].includes(mode)) {
        nativeTheme.themeSource = mode;
    }
    return {
        themeSource: nativeTheme.themeSource,
        shouldUseDarkColors: nativeTheme.shouldUseDarkColors
    };
});

// 应用元数据与分发形态 IPC
ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion() || pkgMeta.version,
    buildNumber: pkgMeta.buildNumber,
    distribution: distributionMode,
    apiBaseUrl: getApiBaseUrl(),
    isPackaged: app.isPackaged
}));

// 自动更新 IPC 调度通道
ipcMain.handle('updater:check', (_event, isManual = false) => {
    return appUpdater ? appUpdater.checkForUpdates(isManual) : { hasUpdate: false };
});

ipcMain.handle('updater:download', () => {
    if (!appUpdater) return Promise.reject(new Error('更新调度器未就绪'));
    return appUpdater.startDownload();
});

ipcMain.handle('updater:install', () => {
    if (!appUpdater) {
        throw new Error('更新调度器未就绪');
    }
    return appUpdater.quitAndInstall();
});

ipcMain.handle('updater:openDownloadDir', () => {
    return appUpdater ? appUpdater.openDownloadDir() : { ok: false };
});

// 文件导出对话框 IPC
ipcMain.handle('dialog:saveMarkdownFile', async (_event, payload = {}) => {
    const { content = '', suggestedName = 'note.md' } = payload;
    const defaultFileName = sanitizeFileName(suggestedName).endsWith('.md')
        ? sanitizeFileName(suggestedName)
        : `${sanitizeFileName(suggestedName)}.md`;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出 Markdown',
        defaultPath: defaultFileName,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
    });

    if (result.canceled || !result.filePath) {
        return { canceled: true };
    }

    await fs.promises.writeFile(result.filePath, content, 'utf-8');
    return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('dialog:saveHtmlFile', async (_event, payload = {}) => {
    const { content = '', suggestedName = 'note.html' } = payload;
    const defaultFileName = sanitizeFileName(suggestedName).endsWith('.html')
        ? sanitizeFileName(suggestedName)
        : `${sanitizeFileName(suggestedName)}.html`;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出 HTML',
        defaultPath: defaultFileName,
        filters: [{ name: 'HTML', extensions: ['html'] }]
    });

    if (result.canceled || !result.filePath) {
        return { canceled: true };
    }

    await fs.promises.writeFile(result.filePath, content, 'utf-8');
    return { canceled: false, filePath: result.filePath };
});

// 本地目录镜像同步白名单 IPC 通道
ipcMain.handle('mirror:selectDir', () => {
    return mirrorService.selectDir(mainWindow);
});

ipcMain.handle('mirror:getConfig', () => {
    return mirrorService.getConfig();
});

ipcMain.handle('mirror:setConfig', (_event, patch = {}) => {
    return mirrorService.setConfig(patch);
});

ipcMain.handle('mirror:runSync', (_event, payload = {}) => {
    return mirrorService.runSync(payload);
});

ipcMain.handle('mirror:openDir', () => {
    return mirrorService.openDir();
});
