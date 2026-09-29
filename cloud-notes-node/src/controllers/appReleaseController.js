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
    const latestRelease = await AppRelease.findOne({
        platform: { $in: [platform, 'all'] },
        isActive: true
    }).sort({ buildNumber: -1 });

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

    // 判断是否强制整包更新：如果客户端版本低于最低兼容版本，强制转为 native 整包强更
    let effectiveType = latestRelease.type;
    let effectiveForce = latestRelease.forceUpdate;

    if (isVersionOlder(currentVersion, latestRelease.minCompatibleVersion)) {
        effectiveType = 'native';
        effectiveForce = true;
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
            size: latestRelease.size,
            apkUrl: resolveUrl(latestRelease.apkUrl),
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
