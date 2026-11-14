const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const MAX_REDIRECTS = 5;

function readPackageFallback() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        return {
            version: pkg.version || '1.0.0',
            buildNumber: Number(pkg.buildNumber) || 1
        };
    } catch {
        return { version: '1.0.0', buildNumber: 1 };
    }
}

function resolveExtensionFromUrl(rawUrl, fallbackKind = 'nsis') {
    const fallbackExt = fallbackKind === 'portable' ? '.zip' : '.exe';
    try {
        const pathname = new URL(rawUrl, 'https://localhost').pathname.toLowerCase();
        if (pathname.endsWith('.zip')) return '.zip';
        if (pathname.endsWith('.exe')) return '.exe';
        return fallbackExt;
    } catch {
        const cleanUrl = String(rawUrl || '').split('?')[0].split('#')[0].toLowerCase();
        if (cleanUrl.endsWith('.zip')) return '.zip';
        if (cleanUrl.endsWith('.exe')) return '.exe';
        return fallbackExt;
    }
}

/**
 * 桌面端轻量自动更新调度器 (AppUpdater)
 * 遵循 Karpathy 原则：基于原生 Node.js 流式管道、校验和与非阻塞广播，零外部依赖。
 */
class AppUpdater {
    constructor(mainWindow = null, options = {}) {
        const electron = options.appModule && options.shellModule
            ? { app: options.appModule, shell: options.shellModule }
            : require('electron');

        this.app = options.appModule || electron.app;
        this.shell = options.shellModule || electron.shell;
        this.spawnFn = options.spawnFn || spawn;
        this.mainWindow = mainWindow;

        const pkgMeta = readPackageFallback();
        this.distribution = options.distribution === 'portable' ? 'portable' : 'nsis';
        this.buildNumber = Number(options.buildNumber) || pkgMeta.buildNumber;
        this.fallbackVersion = pkgMeta.version;

        this.updateInfo = null;
        this.downloadedFilePath = null;
        this.isDownloading = false;
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    getApiBaseUrl() {
        const envUrl = (process.env.CLOUD_NOTES_API_URL || '').trim();
        if (envUrl) return envUrl.replace(/\/+$/, '');
        if (!this.app.isPackaged) {
            return 'http://localhost:3001/api';
        }
        return 'https://notes.yanggenbwebsite.site/api';
    }

    getPlatformKey() {
        if (process.platform === 'win32') return 'windows';
        if (process.platform === 'darwin') return 'mac';
        return 'linux';
    }

    selectPackageFields(rawData = {}) {
        const usePortable = this.distribution === 'portable' && Boolean(rawData.portableUrl);
        const downloadUrl = usePortable
            ? rawData.portableUrl
            : (rawData.downloadUrl || rawData.apkUrl || '');
        const hash = usePortable ? (rawData.portableHash || '') : (rawData.hash || '');
        const size = usePortable ? (rawData.portableSize || 0) : (rawData.size || 0);
        const fallbackKind = usePortable ? 'portable' : 'nsis';
        const ext = resolveExtensionFromUrl(downloadUrl, fallbackKind);

        return {
            downloadUrl,
            hash,
            size,
            packageKind: ext === '.zip' ? 'portable' : 'nsis'
        };
    }

    async checkForUpdates(isManual = false) {
        try {
            const version = this.app.getVersion() || this.fallbackVersion;
            const platform = this.getPlatformKey();
            const query = new URLSearchParams({
                platform,
                currentVersion: version,
                buildNumber: String(this.buildNumber),
                distribution: this.distribution
            }).toString();
            const url = `${this.getApiBaseUrl()}/app/check-update?${query}`;

            const res = await this.httpGetJson(url);
            if (res?.code === 200 && res.data?.hasUpdate) {
                const pkgFields = this.selectPackageFields(res.data);
                this.updateInfo = {
                    ...res.data,
                    ...pkgFields,
                    currentVersion: version,
                    currentBuildNumber: this.buildNumber,
                    distribution: this.distribution
                };
                this.notifyRenderer('update:available', {
                    ...this.updateInfo,
                    isManual
                });
                return { hasUpdate: true, updateInfo: this.updateInfo };
            }

            this.updateInfo = null;
            this.notifyRenderer('update:not-available', {
                currentVersion: version,
                buildNumber: this.buildNumber,
                distribution: this.distribution,
                isManual
            });
            return {
                hasUpdate: false,
                currentVersion: version,
                buildNumber: this.buildNumber,
                distribution: this.distribution
            };
        } catch (err) {
            console.error('[AppUpdater] check update error:', err.message);
            this.notifyRenderer('update:error', {
                message: err.message || '检查更新失败',
                isManual
            });
            return { hasUpdate: false, error: err.message };
        }
    }

    async startDownload() {
        const targetUrl = this.updateInfo?.downloadUrl || this.updateInfo?.apkUrl;
        if (!targetUrl) {
            throw new Error('未发现可用的新版本下载地址');
        }
        if (this.isDownloading) return undefined;

        this.isDownloading = true;
        try {
            return await this.downloadToTemp(targetUrl, 0);
        } finally {
            this.isDownloading = false;
        }
    }

    downloadToTemp(targetUrl, redirectDepth = 0) {
        if (redirectDepth > MAX_REDIRECTS) {
            const err = new Error('更新包下载重定向次数过多');
            this.notifyRenderer('update:error', { message: err.message });
            return Promise.reject(err);
        }

        const ext = resolveExtensionFromUrl(targetUrl, this.updateInfo?.packageKind);
        const tempDir = path.join(this.app.getPath('temp'), 'cloud-notes-update');
        fs.mkdirSync(tempDir, { recursive: true });
        const targetPath = path.join(tempDir, `CloudNotes-v${this.updateInfo.version}${ext}`);
        this.downloadedFilePath = targetPath;

        return new Promise((resolve, reject) => {
            const client = targetUrl.startsWith('https') ? https : http;
            const request = client.get(targetUrl, response => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    const nextUrl = new URL(response.headers.location, targetUrl).toString();
                    this.updateInfo.downloadUrl = nextUrl;
                    return this.downloadToTemp(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    const err = new Error(`下载失败 HTTP ${response.statusCode}`);
                    this.notifyRenderer('update:error', { message: err.message });
                    return reject(err);
                }

                const totalBytes = parseInt(response.headers['content-length'] || '0', 10) || this.updateInfo.size || 0;
                const fileStream = fs.createWriteStream(targetPath);
                const hashStream = crypto.createHash('sha256');
                let settled = false;
                let downloadedBytes = 0;
                let lastTime = Date.now();
                let lastBytes = 0;
                let lastEmitTime = 0;

                const failDownload = err => {
                    if (settled) return;
                    settled = true;
                    fileStream.destroy();
                    try { fs.unlinkSync(targetPath); } catch {}
                    this.notifyRenderer('update:error', { message: err.message });
                    reject(err);
                };

                fileStream.on('error', failDownload);
                response.on('error', failDownload);

                response.on('data', chunk => {
                    downloadedBytes += chunk.length;
                    fileStream.write(chunk);
                    hashStream.update(chunk);

                    const now = Date.now();
                    if (now - lastEmitTime > 160 || (totalBytes > 0 && downloadedBytes === totalBytes)) {
                        const timeDiff = (now - lastTime) / 1000;
                        const bytesDiff = downloadedBytes - lastBytes;
                        const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                        const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;

                        lastTime = now;
                        lastBytes = downloadedBytes;
                        lastEmitTime = now;

                        this.notifyRenderer('update:download-progress', {
                            percent,
                            speed,
                            transferred: downloadedBytes,
                            total: totalBytes
                        });
                    }
                });

                response.on('end', () => {
                    if (response.complete === false) {
                        return failDownload(new Error('下载连接意外中断'));
                    }

                    // 必须等待 WriteStream 刷盘并释放文件锁后再校验哈希与通知安装，杜绝 Windows EBUSY
                    fileStream.once('close', () => {
                        if (settled) return;
                        settled = true;
                        const calculatedHash = hashStream.digest('hex');

                        if (this.updateInfo.hash && calculatedHash !== this.updateInfo.hash.toLowerCase()) {
                            try { fs.unlinkSync(targetPath); } catch {}
                            const err = new Error('安装包校验和不匹配，可能存在损坏');
                            this.notifyRenderer('update:error', { message: err.message });
                            return reject(err);
                        }

                        this.notifyRenderer('update:downloaded', {
                            filePath: targetPath,
                            version: this.updateInfo.version,
                            packageKind: ext === '.zip' ? 'portable' : 'nsis',
                            distribution: this.distribution,
                            hash: calculatedHash
                        });
                        resolve(targetPath);
                    });

                    fileStream.end();
                });
            });

            request.on('error', err => {
                this.notifyRenderer('update:error', { message: err.message });
                reject(err);
            });
        });
    }

    quitAndInstall() {
        if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
            throw new Error('未找到已就绪的安装文件');
        }

        if (path.extname(this.downloadedFilePath).toLowerCase() === '.zip') {
            this.shell.showItemInFolder(this.downloadedFilePath);
            return {
                action: 'revealed',
                filePath: this.downloadedFilePath
            };
        }

        this.spawnFn(this.downloadedFilePath, [], {
            detached: true,
            stdio: 'ignore'
        }).unref();

        this.app.quit();
        return {
            action: 'installing',
            filePath: this.downloadedFilePath
        };
    }

    openDownloadDir() {
        if (this.downloadedFilePath && fs.existsSync(this.downloadedFilePath)) {
            this.shell.showItemInFolder(this.downloadedFilePath);
            return { ok: true, filePath: this.downloadedFilePath };
        }
        const tempDir = path.join(this.app.getPath('temp'), 'cloud-notes-update');
        if (fs.existsSync(tempDir)) {
            this.shell.openPath(tempDir);
            return { ok: true, dir: tempDir };
        }
        return { ok: false };
    }

    notifyRenderer(channel, payload) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, payload);
        }
    }

    httpGetJson(url, redirectDepth = 0) {
        if (redirectDepth > MAX_REDIRECTS) {
            return Promise.reject(new Error('检查更新重定向次数过多'));
        }
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { timeout: 8000 }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    const nextUrl = new URL(res.headers.location, url).toString();
                    return this.httpGetJson(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
                }
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error('Invalid JSON response'));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });
        });
    }
}

module.exports = AppUpdater;
