const { app } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

/**
 * 桌面端轻量自动更新调度器 (AppUpdater)
 * 遵循 Karpathy 原则：基于原生 Node.js 流式管道、校验和与非阻塞广播，零外部依赖。
 */
class AppUpdater {
    constructor(mainWindow = null) {
        this.mainWindow = mainWindow;
        this.updateInfo = null;
        this.downloadedFilePath = null;
        this.isDownloading = false;
    }

    setMainWindow(win) {
        this.mainWindow = win;
    }

    getApiBaseUrl() {
        if (!app.isPackaged) {
            return process.env.CLOUD_NOTES_API_URL || 'http://localhost:5000/api';
        }
        return process.env.CLOUD_NOTES_API_URL || 'https://notes.yanggenbwebsite.site/api';
    }

    async checkForUpdates(isManual = false) {
        try {
            const version = app.getVersion() || '0.1.0';
            const platform = process.platform === 'win32' ? 'windows' : (process.platform === 'darwin' ? 'mac' : 'linux');
            const url = `${this.getApiBaseUrl()}/app/check-update?platform=${platform}&currentVersion=${version}&buildNumber=1`;

            const res = await this.httpGetJson(url);
            if (res?.code === 200 && res.data?.hasUpdate) {
                this.updateInfo = res.data;
                this.notifyRenderer('update:available', {
                    ...res.data,
                    isManual
                });
                return { hasUpdate: true, updateInfo: res.data };
            }

            this.updateInfo = null;
            this.notifyRenderer('update:not-available', {
                currentVersion: version,
                isManual
            });
            return { hasUpdate: false, currentVersion: version };
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
        if (this.isDownloading) return;

        this.isDownloading = true;
        const tempDir = path.join(app.getPath('temp'), 'cloud-notes-update');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const ext = targetUrl.endsWith('.zip') ? '.zip' : '.exe';
        const targetPath = path.join(tempDir, `CloudNotes-v${this.updateInfo.version}${ext}`);
        this.downloadedFilePath = targetPath;

        const fileStream = fs.createWriteStream(targetPath);
        const hashStream = crypto.createHash('sha256');

        return new Promise((resolve, reject) => {
            const client = targetUrl.startsWith('https') ? https : http;
            let downloadedBytes = 0;
            let lastTime = Date.now();
            let lastBytes = 0;
            let lastEmitTime = 0;

            const request = client.get(targetUrl, response => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    this.isDownloading = false;
                    this.updateInfo.downloadUrl = response.headers.location;
                    return this.startDownload().then(resolve).catch(reject);
                }

                if (response.statusCode !== 200) {
                    this.isDownloading = false;
                    const err = new Error(`下载失败 HTTP ${response.statusCode}`);
                    this.notifyRenderer('update:error', { message: err.message });
                    return reject(err);
                }

                const totalBytes = parseInt(response.headers['content-length'] || '0', 10) || this.updateInfo.size || 0;

                response.on('data', chunk => {
                    downloadedBytes += chunk.length;
                    fileStream.write(chunk);
                    hashStream.update(chunk);

                    const now = Date.now();
                    if (now - lastEmitTime > 160 || downloadedBytes === totalBytes) {
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
                    fileStream.end();
                    this.isDownloading = false;
                    const calculatedHash = hashStream.digest('hex');

                    if (this.updateInfo.hash && calculatedHash !== this.updateInfo.hash.toLowerCase()) {
                        const err = new Error('安装包校验和不匹配，可能存在损坏');
                        this.notifyRenderer('update:error', { message: err.message });
                        return reject(err);
                    }

                    this.notifyRenderer('update:downloaded', {
                        filePath: targetPath,
                        version: this.updateInfo.version
                    });
                    resolve(targetPath);
                });
            });

            request.on('error', err => {
                this.isDownloading = false;
                try { fs.unlinkSync(targetPath); } catch {}
                this.notifyRenderer('update:error', { message: err.message });
                reject(err);
            });
        });
    }

    quitAndInstall() {
        if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
            throw new Error('未找到已就绪的安装文件');
        }

        spawn(this.downloadedFilePath, [], {
            detached: true,
            stdio: 'ignore'
        }).unref();

        app.quit();
    }

    notifyRenderer(channel, payload) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, payload);
        }
    }

    httpGetJson(url) {
        return new Promise((resolve, reject) => {
            const client = url.startsWith('https') ? https : http;
            const req = client.get(url, { timeout: 8000 }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this.httpGetJson(res.headers.location).then(resolve).catch(reject);
                }
                let data = '';
                res.on('data', chunk => data += chunk);
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
