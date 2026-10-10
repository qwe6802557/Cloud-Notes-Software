const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const https = require('https');

const mobileRoot = path.resolve(__dirname, '..');
const appJsonPath = path.join(mobileRoot, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

// 从命令行解析参数
const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1]) {
        return args[idx + 1];
    }
    return fallback;
};
const hasFlag = name => args.includes(`--${name}`);

const releaseType = getArg('type', 'ota'); // 'ota' | 'native'
const platform = getArg('platform', 'all');
const version = getArg('version', appJson.expo.version || '1.0.1');
const buildNumber = parseInt(getArg('build', String(appJson.expo.android?.versionCode || 101)), 10);
const changelog = getArg('changelog', '· 新增「文件暂存」跨端即时互传中转站\n· 优化图片懒加载性能与长图浏览体验\n· 界面细节打磨与系统稳定性提升');
const forceUpdate = hasFlag('force');
const defaultApkCandidate = path.join(mobileRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const apkPath = getArg('apk-path', fs.existsSync(defaultApkCandidate) ? defaultApkCandidate : '');

const SSH_KEY = 'C:\\Users\\Administrator\\.ssh\\id_ed25519_tencentyun';
const SERVER_HOST = '1.15.171.111';
const SERVER_USER = 'ubuntu';
const DOMAIN = 'https://notes.yanggenbwebsite.site';
const RELEASE_SECRET = 'NyygOCUrbr16h+4XIG0p52VhowQuhAxbp1RZmXgCfnd+dlLuxyeAgj6U4H901Saa';

console.log('\n🚀 ========== 囧人云笔记 移动端版本发布引擎 ==========');
console.log(`📦 发布类型: ${releaseType === 'ota' ? '⚡ 极速热更新 (OTA)' : '📦 原生安装包升级 (APK)'}`);
console.log(`🏷️ 目标版本: v${version} (Build: ${buildNumber})`);
console.log(`🔒 强制更新: ${forceUpdate ? '是 (锁定应用)' : '否 (用户可选择稍后)'}`);
console.log(`📝 更新日志:\n${changelog}\n`);

async function run() {
    try {
        let bundleFileName = '';
        let bundleHash = '';
        let bundleSize = 0;
        let finalApkUrl = '';

        if (releaseType === 'ota') {
            console.log('⏳ [1/4] 正在导出生产 React Native Bundle 与静态资源 (npx expo export)...');
            const distDir = path.join(mobileRoot, 'dist');
            if (fs.existsSync(distDir)) {
                fs.rmSync(distDir, { recursive: true, force: true });
            }

            execSync('npx expo export --platform android', {
                cwd: mobileRoot,
                stdio: 'inherit'
            });

            console.log('⏳ [2/4] 正在打包归档生产静态资产与 Hermes 字节码...');
            const metadataPath = path.join(distDir, 'metadata.json');
            if (!fs.existsSync(metadataPath)) {
                throw new Error('未找到导出的 metadata.json');
            }
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            const androidBundleRel = metadata.fileMetadata?.android?.bundle;
            if (!androidBundleRel) {
                throw new Error('metadata.json 中缺失 android bundle 信息');
            }
            const bundleFullPath = path.join(distDir, androidBundleRel);
            const bundleBuffer = fs.readFileSync(bundleFullPath);
            bundleSize = bundleBuffer.length;
            bundleHash = crypto.createHash('sha256').update(bundleBuffer).digest('hex');

            const localTarPath = path.join(mobileRoot, 'ota-dist.tar.gz');
            if (fs.existsSync(localTarPath)) fs.unlinkSync(localTarPath);
            execSync(`tar -czf "${localTarPath}" -C "${distDir}" .`, { cwd: mobileRoot, stdio: 'inherit' });

            bundleFileName = `bundle-v${version}-b${buildNumber}.zip`;
            const localZipPath = path.join(mobileRoot, bundleFileName);
            if (fs.existsSync(localZipPath)) fs.unlinkSync(localZipPath);
            execSync(`powershell -Command "Compress-Archive -Path '${distDir}\\*' -DestinationPath '${localZipPath}' -Force"`, {
                cwd: mobileRoot,
                stdio: 'inherit'
            });

            console.log(`✅ 热更包打包完成: ${(bundleSize / 1024 / 1024).toFixed(2)} MB, SHA256: ${bundleHash.substring(0, 16)}...`);

            console.log('⏳ [3/4] 安全上传至腾讯云生产服务器 /var/lib/cloud-notes/updates/ota/ ...');
            execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "sudo mkdir -p /var/lib/cloud-notes/updates/ota && sudo chown -R ubuntu:ubuntu /var/lib/cloud-notes/updates"`, { stdio: 'inherit' });
            execSync(`scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${localTarPath}" ${SERVER_USER}@${SERVER_HOST}:/var/lib/cloud-notes/updates/ota-dist.tar.gz`, { stdio: 'inherit' });
            execSync(`scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${localZipPath}" ${SERVER_USER}@${SERVER_HOST}:/var/lib/cloud-notes/updates/${bundleFileName}`, { stdio: 'inherit' });
            execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "rm -rf /var/lib/cloud-notes/updates/ota/* && tar -xzf /var/lib/cloud-notes/updates/ota-dist.tar.gz -C /var/lib/cloud-notes/updates/ota && rm -f /var/lib/cloud-notes/updates/ota-dist.tar.gz"`, { stdio: 'inherit' });

            if (fs.existsSync(localTarPath)) fs.unlinkSync(localTarPath);
            if (fs.existsSync(localZipPath)) fs.unlinkSync(localZipPath);
        } else {
            // 原生 APK 发布分支
            if (!apkPath || !fs.existsSync(apkPath)) {
                throw new Error(`请通过 --apk-path 指定有效的本地 APK 文件路径`);
            }
            const fileBuffer = fs.readFileSync(apkPath);
            bundleSize = fileBuffer.length;
            bundleHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            const apkFileName = `cloud-notes-v${version}-b${buildNumber}.apk`;
            console.log(`⏳ 上传原生 APK (${path.basename(apkPath)}, ${(bundleSize / 1024 / 1024).toFixed(2)} MB) 至服务器...`);
            execSync(`scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${apkPath}" ${SERVER_USER}@${SERVER_HOST}:/var/lib/cloud-notes/updates/${apkFileName}`, { stdio: 'inherit' });
            execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${SERVER_USER}@${SERVER_HOST} "cp -f /var/lib/cloud-notes/updates/${apkFileName} /var/lib/cloud-notes/updates/cloud-notes-latest.apk"`, { stdio: 'inherit' });
            finalApkUrl = `${DOMAIN}/updates/${apkFileName}`;
        }

        console.log('⏳ [4/4] 正在向生产版本中心登记新版本并全网推送...');
        const payload = JSON.stringify({
            releaseSecret: RELEASE_SECRET,
            platform,
            version,
            buildNumber,
            type: releaseType,
            forceUpdate,
            title: `发现新版本 v${version}`,
            changelog,
            downloadUrl: releaseType === 'ota' ? `${DOMAIN}/updates/${bundleFileName}` : '',
            hash: bundleHash,
            size: bundleSize,
            apkUrl: finalApkUrl || `${DOMAIN}/updates/cloud-notes-latest.apk`
        });

        const req = https.request(`${DOMAIN}/api/app/release`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log('🎉 ==============================================');
                    console.log(`🚀 新版本 v${version} (Build: ${buildNumber}) 发布成功！`);
                    console.log(`📱 手机端用户打开 App 将主动收到更新通知并自动应用！`);
                    console.log('🎉 ==============================================');
                } else {
                    console.error('❌ 版本登记失败:', body);
                    process.exit(1);
                }
            });
        });

        req.on('error', err => {
            console.error('❌ 请求服务端发布接口失败:', err.message);
            process.exit(1);
        });

        req.write(payload);
        req.end();

    } catch (err) {
        console.error('💥 发布流程中断:', err.message);
        process.exit(1);
    }
}

run();
