const fs = require('fs');
const path = require('path');
const AppRelease = require('../models/AppRelease');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const config = require('../config');

// 简易语义化版本比对: vA < vB 返回 true
const isVersionOlder = (vA, vB) => {
    if (!vA || !vB) return false;
    const partsA = vA.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const partsB = vB.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA < numB) return true;
        if (numA > numB) return false;
    }
    return false;
};

/**
 * 客户端检查更新接口 (公开接口，免登录)
 * GET /app/check-update?platform=android&currentVersion=1.0.0&buildNumber=100
 */
exports.checkUpdate = asyncHandler(async (req, res) => {
    const { platform = 'android', currentVersion = '1.0.0', buildNumber = 0 } = req.query;
    const clientBuild = parseInt(buildNumber, 10) || 0;

    // 查找当前平台或全平台适用的最新激活版本
    let latestRelease = await AppRelease.findOne({
        platform: { $in: [platform, 'all'] },
        isActive: true
    }).sort({ buildNumber: -1 });

    // 兜底：若未配置特定平台，获取全平台最新激活版本
    if (!latestRelease) {
        latestRelease = await AppRelease.findOne({
            isActive: true
        }).sort({ buildNumber: -1 });
    }

    if (!latestRelease) {
        return res.status(200).json({
            code: 200,
            message: '当前已是最新版本',
            data: {
                hasUpdate: false,
                currentVersion,
                latestVersion: currentVersion
            }
        });
    }

    const hasNewerBuild = latestRelease.buildNumber > clientBuild;
    const hasNewerVersion = isVersionOlder(currentVersion, latestRelease.version);

    if (!hasNewerBuild && !hasNewerVersion) {
        return res.status(200).json({
            code: 200,
            message: '当前已是最新版本',
            data: {
                hasUpdate: false,
                currentVersion,
                latestVersion: latestRelease.version
            }
        });
    }

    // 判断是否强制整包更新：如果客户端版本低于最低兼容版本，或原生构建未激活 OTA (buildNumber < 15)，强制降级为 native 整包
    let effectiveType = latestRelease.type;
    let effectiveForce = latestRelease.forceUpdate;

    if (isVersionOlder(currentVersion, latestRelease.minCompatibleVersion) || clientBuild < 15) {
        effectiveType = 'native';
        effectiveForce = true;
    }

    // 若下发整包，获取对应原生安装包体积与直链
    let effectiveSize = latestRelease.size;
    let effectiveApkUrl = latestRelease.apkUrl;

    if (effectiveType === 'native' && latestRelease.type !== 'native') {
        const latestNative = await AppRelease.findOne({
            platform: { $in: [platform, 'all'] },
            type: 'native',
            isActive: true
        }).sort({ buildNumber: -1 });

        if (latestNative) {
            effectiveSize = latestNative.size || effectiveSize;
            effectiveApkUrl = latestNative.apkUrl || effectiveApkUrl;
        }
    }

    // 格式化下载直链前缀
    const getBaseUrl = () => {
        if (config.publicBaseUrl) return config.publicBaseUrl;
        return `${req.protocol}://${req.get('host')}`;
    };
    const baseUrl = getBaseUrl();

    const resolveUrl = url => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    res.status(200).json({
        code: 200,
        message: '发现新版本',
        data: {
            hasUpdate: true,
            type: effectiveType,
            version: latestRelease.version,
            buildNumber: latestRelease.buildNumber,
            forceUpdate: effectiveForce,
            minCompatibleVersion: latestRelease.minCompatibleVersion,
            title: latestRelease.title || `发现新版本 v${latestRelease.version}`,
            changelog: latestRelease.changelog || '功能优化与体验提升',
            downloadUrl: resolveUrl(latestRelease.downloadUrl),
            hash: latestRelease.hash,
            size: effectiveSize,
            apkUrl: resolveUrl(effectiveApkUrl),
            releaseDate: latestRelease.createdAt
        }
    });
});

/**
 * 发布新版本 (管理发布接口，支持脚本自动鉴权发布)
 * POST /app/release
 */
exports.publishRelease = asyncHandler(async (req, res) => {
    const {
        releaseSecret,
        platform = 'android',
        version,
        buildNumber,
        type = 'ota',
        forceUpdate = false,
        minCompatibleVersion = '1.0.0',
        title,
        changelog,
        downloadUrl,
        hash,
        size,
        apkUrl
    } = req.body;

    // 校验密钥：防止未授权提交
    const validSecret = process.env.RELEASE_SECRET || config.jwtSecret;
    if (!releaseSecret || releaseSecret !== validSecret) {
        throw new AppError('发布密钥无效或无权操作', 403);
    }

    if (!version || buildNumber === undefined) {
        throw new AppError('version 与 buildNumber 为必填项', 400);
    }

    // 检查是否存在同版本
    let release = await AppRelease.findOne({ platform, buildNumber });
    if (release) {
        release.version = version;
        release.type = type;
        release.forceUpdate = forceUpdate;
        release.minCompatibleVersion = minCompatibleVersion;
        release.title = title || `发现新版本 v${version}`;
        release.changelog = changelog || '';
        release.downloadUrl = downloadUrl || '';
        release.hash = hash || '';
        release.size = size || 0;
        release.apkUrl = apkUrl || '';
        release.isActive = true;
        release.createdAt = new Date();
        await release.save();
    } else {
        release = await AppRelease.create({
            platform,
            version,
            buildNumber: parseInt(buildNumber, 10),
            type,
            forceUpdate,
            minCompatibleVersion,
            title: title || `发现新版本 v${version}`,
            changelog: changelog || '',
            downloadUrl: downloadUrl || '',
            hash: hash || '',
            size: size || 0,
            apkUrl: apkUrl || '',
            isActive: true
        });
    }

    res.status(201).json({
        code: 200,
        message: '版本发布成功',
        data: release
    });
});

/**
 * 获取版本列表 (历史版本)
 * GET /app/releases
 */
exports.getReleases = asyncHandler(async (req, res) => {
    const releases = await AppRelease.find().sort({ buildNumber: -1 }).limit(20);
    res.status(200).json({
        code: 200,
        message: '获取版本历史成功',
        data: releases
    });
});

/**
 * 将任意哈希或种子字符串转换为确定性的标准 UUID v4 格式 (8-4-4-4-12)
 * Android 原生 ExpoUpdatesUpdate.fromExpoUpdatesManifest 强制调用 UUID.fromString(manifest.getID())
 */
const toDeterministicUuid = seed => {
    const crypto = require('crypto');
    const raw = String(seed || 'cloud-notes-ota').trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
        return raw.toLowerCase();
    }
    const hex = /^[0-9a-f]{32,}$/i.test(raw)
        ? raw.toLowerCase()
        : crypto.createHash('sha256').update(raw).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/**
 * Expo Updates 官方协议 Manifest 接口
 * GET /app/manifest
 */
exports.getManifest = asyncHandler(async (req, res) => {
    const platform = req.headers['expo-platform'] || req.query.platform || 'android';
    const runtimeVersion = req.headers['expo-runtime-version'] || req.query.runtimeVersion;
    const clientUpdateId = req.headers['expo-current-update-id'];

    const latestOta = await AppRelease.findOne({
        platform: { $in: [platform, 'all'] },
        type: 'ota',
        isActive: true
    }).sort({ buildNumber: -1 });

    if (!latestOta) {
        res.setHeader('expo-protocol-version', '1');
        res.setHeader('expo-sfv-version', '0');
        return res.status(204).end();
    }

    // 校验原生底包是否满足最低兼容版本要求
    const minCompatible = latestOta.minCompatibleVersion || '1.0.0';
    if (runtimeVersion && isVersionOlder(runtimeVersion, minCompatible)) {
        res.setHeader('expo-protocol-version', '1');
        res.setHeader('expo-sfv-version', '0');
        return res.status(204).end();
    }

    const manifestId = toDeterministicUuid(
        latestOta.hash || `${latestOta.version}-b${latestOta.buildNumber}`
    );

    if (
        clientUpdateId &&
        (clientUpdateId.toLowerCase() === manifestId || clientUpdateId === latestOta.hash)
    ) {
        res.setHeader('expo-protocol-version', '1');
        res.setHeader('expo-sfv-version', '0');
        return res.status(204).end();
    }

    const otaDir = process.env.OTA_DIR || '/var/lib/cloud-notes/updates/ota';
    const metadataPath = path.join(otaDir, 'metadata.json');

    let fileMetadata = null;
    if (fs.existsSync(metadataPath)) {
        try {
            const raw = fs.readFileSync(metadataPath, 'utf8');
            fileMetadata = JSON.parse(raw);
        } catch {
            fileMetadata = null;
        }
    }

    if (!fileMetadata || !fileMetadata.fileMetadata || !fileMetadata.fileMetadata[platform]) {
        res.setHeader('expo-protocol-version', '1');
        res.setHeader('expo-sfv-version', '0');
        return res.status(204).end();
    }

    const platformMeta = fileMetadata.fileMetadata[platform];
    const baseUrl = config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    const updatesBaseUrl = `${baseUrl}/updates/ota`;

    const mimeMap = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        ttf: 'font/ttf',
        otf: 'font/otf',
        woff: 'font/woff',
        woff2: 'font/woff2',
        js: 'application/javascript',
        hbc: 'application/javascript'
    };

    const bundlePath = (platformMeta.bundle || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const bundleExt = path.posix.extname(bundlePath) || '.hbc';
    const bundleBase = path.posix.basename(bundlePath, bundleExt) || 'bundle';
    // key 严禁包含路径分隔符 '/'，且每次构建必须唯一，防止 SQLite assets 表命中旧缓存
    const launchAssetKey = latestOta.hash
        ? `bundle-${latestOta.hash.slice(0, 32)}`
        : `${bundleBase}-b${latestOta.buildNumber}`;

    const launchAsset = {
        key: launchAssetKey,
        contentType: 'application/javascript',
        fileExtension: bundleExt,
        url: `${updatesBaseUrl}/${bundlePath}`
    };

    const assets = (platformMeta.assets || []).map(asset => {
        const cleanPath = (asset.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        // 关键修复：必须剥离 'assets/' 目录前缀，仅保留纯 packagerHash 文件名作为 key
        // 否则 Android 原生 UpdatesUtils.isSafeFilename 会因包含 '/' 抛出 IOException 拒绝加载，
        // 且剥离后可直接匹配 APK 内嵌 app.manifest 的 packagerHash 免去重复下载静态字体/图标
        const assetKey = path.posix.basename(cleanPath);
        const ext = asset.ext || '';
        return {
            key: assetKey,
            contentType: mimeMap[ext] || 'application/octet-stream',
            fileExtension: ext ? `.${ext}` : '',
            url: `${updatesBaseUrl}/${cleanPath}`
        };
    });

    const commitDate = latestOta.updatedAt || latestOta.createdAt || new Date();
    const effectiveRuntimeVersion = runtimeVersion || '1.0.7';

    const manifest = {
        id: manifestId,
        createdAt: new Date(commitDate).toISOString(),
        runtimeVersion: effectiveRuntimeVersion,
        launchAsset,
        assets,
        metadata: {
            buildNumber: String(latestOta.buildNumber),
            forceUpdate: String(Boolean(latestOta.forceUpdate))
        },
        extra: {
            scopeKey: 'jiong-ren-note',
            expoClient: {
                name: '囧人云笔记',
                slug: 'jiong-ren-note',
                scheme: 'jiongrennote',
                version: latestOta.version,
                runtimeVersion: effectiveRuntimeVersion,
                android: {
                    package: 'com.jiongren.cloudnotes',
                    versionCode: latestOta.buildNumber
                },
                ios: {
                    buildNumber: String(latestOta.buildNumber)
                }
            }
        }
    };

    res.setHeader('expo-protocol-version', '1');
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('cache-control', 'private, max-age=0');

    const acceptHeader = req.headers.accept || '';
    if (acceptHeader.includes('multipart/mixed')) {
        const boundary = '---------------------------expo-updates-boundary';
        const manifestString = JSON.stringify(manifest);
        res.setHeader('content-type', `multipart/mixed; boundary=${boundary}`);
        const body =
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="manifest"\r\n` +
            `Content-Type: application/expo+json; charset=utf-8\r\n\r\n` +
            `${manifestString}\r\n` +
            `--${boundary}--\r\n`;
        return res.status(200).send(body);
    }

    res.setHeader('content-type', 'application/expo+json; charset=utf-8');
    return res.status(200).json(manifest);
});

