const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const StashFile = require('../models/StashFile');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const config = require('../config');
const { getStashDir, cleanupExpiredFiles } = require('../services/stashCleanupService');

const getFileUrl = req => {
    if (config.publicBaseUrl) {
        return config.publicBaseUrl;
    }
    const protocol = req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}`;
};

/**
 * 修复 Multer / Busboy 将 UTF-8 原始文件名错误按 Latin-1 (ISO-8859-1) 解码产生的乱码
 * 如果已经是正确 UTF-8 或标准 ASCII 则安全原样返回
 */
const fixEncoding = str => {
    if (!str || typeof str !== 'string') return '';
    try {
        const restored = Buffer.from(str, 'latin1').toString('utf8');
        if (restored && restored !== str && !restored.includes('\uFFFD')) {
            return restored;
        }
    } catch {
        // fallback
    }
    return str;
};

/**
 * 上传文件到暂存区 (支持 临时文件/永久文件, 单文件/文件夹子文件)
 */
exports.uploadFile = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('请选择要上传的文件', 400);
    }

    const storageType = req.body.storageType === 'permanent' ? 'permanent' : 'temp';
    let expireAt = null;

    if (storageType === 'temp') {
        if (req.body.batchExpireAt) {
            const parsedExpireAt = new Date(req.body.batchExpireAt);
            expireAt = !isNaN(parsedExpireAt.getTime()) ? parsedExpireAt : new Date(Date.now() + 10 * 60 * 1000);
        } else {
            expireAt = new Date(Date.now() + 10 * 60 * 1000); // 严格 10 分钟后过期
        }
    }

    const rawRelativePath = (req.body.relativePath || '').trim();
    const relativePath = fixEncoding(rawRelativePath).replace(/\\/g, '/').replace(/^\/+/, '');
    let folderName = fixEncoding((req.body.folderName || '').trim());
    if (!folderName && relativePath.includes('/')) {
        folderName = relativePath.split('/')[0];
    }

    const baseUrl = getFileUrl(req);
    const relativeUrl = `/uploads/stash/${req.file.filename}`;
    const fileUrl = `${baseUrl}${relativeUrl}`;

    let originalName = (req.body.originalName || '').trim();
    if (!originalName && req.file.originalname) {
        originalName = fixEncoding(req.file.originalname);
    }
    if (!originalName) {
        originalName = req.file.filename;
    }

    const newFile = await StashFile.create({
        userId: req.user._id,
        filename: req.file.filename,
        originalName,
        relativePath,
        folderName,
        size: req.file.size,
        mimetype: req.file.mimetype || 'application/octet-stream',
        storageType,
        expireAt,
        url: fileUrl
    });

    const remainingSeconds = storageType === 'temp' && newFile.expireAt
        ? Math.max(0, Math.floor((new Date(newFile.expireAt) - Date.now()) / 1000))
        : null;

    res.status(201).json({
        code: 200,
        message: storageType === 'temp' ? '临时文件已暂存（10分钟后自动销毁）' : '永久文件已暂存',
        data: {
            ...newFile.toObject(),
            remainingSeconds
        }
    });
});

/**
 * 获取用户的文件暂存列表
 */
exports.listFiles = asyncHandler(async (req, res) => {
    // 列表查询前先触发一次惰性清理，保证返回的列表 100% 无过期脏数据
    await cleanupExpiredFiles();

    const { type } = req.query; // 'temp' | 'permanent' | undefined (all)
    const query = { userId: req.user._id };

    if (type && ['temp', 'permanent'].includes(type)) {
        query.storageType = type;
    }

    const files = await StashFile.find(query).sort({ createdAt: -1 }).lean();

    const now = Date.now();
    const formattedFiles = files.map(file => {
        const repairedName = fixEncoding(file.originalName);
        const repairedRelPath = fixEncoding(file.relativePath);
        const repairedFolder = fixEncoding(file.folderName);

        // 如果检测到原先入库的数据存在 latin1 乱码，平滑更新数据库纠偏
        if (
            repairedName !== file.originalName ||
            repairedRelPath !== file.relativePath ||
            repairedFolder !== file.folderName
        ) {
            StashFile.updateOne(
                { _id: file._id },
                {
                    $set: {
                        originalName: repairedName,
                        relativePath: repairedRelPath,
                        folderName: repairedFolder
                    }
                }
            ).catch(() => {});
        }

        const remainingSeconds = file.storageType === 'temp' && file.expireAt
            ? Math.max(0, Math.floor((new Date(file.expireAt).getTime() - now) / 1000))
            : null;

        return {
            ...file,
            originalName: repairedName,
            relativePath: repairedRelPath,
            folderName: repairedFolder,
            remainingSeconds
        };
    });

    // 统计双分区数量与总占用
    const [tempCount, permanentCount] = await Promise.all([
        StashFile.countDocuments({ userId: req.user._id, storageType: 'temp' }),
        StashFile.countDocuments({ userId: req.user._id, storageType: 'permanent' })
    ]);

    res.status(200).json({
        code: 200,
        message: '获取暂存文件列表成功',
        data: {
            files: formattedFiles,
            tempCount,
            permanentCount
        }
    });
});

/**
 * 临时文件转为永久文件
 */
exports.promoteToPermanent = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const file = await StashFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
        throw new AppError('指定的文件不存在或已过期删除', 404);
    }

    if (file.storageType === 'permanent') {
        return res.status(200).json({
            code: 200,
            message: '该文件已经是永久文件',
            data: file
        });
    }

    file.storageType = 'permanent';
    file.expireAt = null;
    await file.save();

    res.status(200).json({
        code: 200,
        message: '已转为永久保存文件',
        data: {
            ...file.toObject(),
            remainingSeconds: null
        }
    });
});

/**
 * 手动删除暂存文件（联动物理磁盘彻底删除）
 */
exports.deleteFile = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const file = await StashFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
        throw new AppError('指定的文件不存在', 404);
    }

    // 物理删除磁盘文件
    const stashDir = getStashDir();
    const filePath = path.join(stashDir, file.filename);
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
    } catch (err) {
        console.error(`删除物理暂存文件异常 (${file.filename}):`, err.message);
    }

    await StashFile.deleteOne({ _id: id });

    res.status(200).json({
        code: 200,
        message: '文件已删除',
        data: { id }
    });
});

/**
 * 下载暂存文件（支持保持原始文件名 Content-Disposition 响应）
 */
exports.downloadFile = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const file = await StashFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
        throw new AppError('文件不存在或已过期', 404);
    }

    const stashDir = getStashDir();
    const filePath = path.join(stashDir, file.filename);

    if (!fs.existsSync(filePath)) {
        throw new AppError('服务器物理文件不存在或已被自动清理', 404);
    }

    res.download(filePath, fixEncoding(file.originalName));
});

/**
 * 临时文件夹一键转为永久保存
 */
exports.promoteFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.body?.folderName;
    const folderName = fixEncoding(rawFolderName);
    if (!folderName) {
        throw new AppError('请指定要转永久的文件夹名称', 400);
    }

    const query = {
        userId: req.user._id,
        storageType: 'temp',
        $or: [
            { folderName },
            { folderName: rawFolderName }
        ]
    };

    const count = await StashFile.countDocuments(query);
    if (count === 0) {
        throw new AppError('指定的文件夹不存在或已过期销毁', 404);
    }

    await StashFile.updateMany(query, {
        $set: {
            storageType: 'permanent',
            folderName,
            expireAt: null
        }
    });

    res.status(200).json({
        code: 200,
        message: `文件夹【${folderName}】内共 ${count} 个文件已全部转为永久保存`,
        data: { folderName, count }
    });
});

/**
 * 彻底删除整个文件夹及其内部所有实体文件
 */
exports.deleteFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.body?.folderName || req.query?.folderName;
    const folderName = fixEncoding(rawFolderName);
    const storageType = req.body?.storageType || req.query?.storageType;

    if (!folderName) {
        throw new AppError('请指定要删除的文件夹名称', 400);
    }

    const query = {
        userId: req.user._id,
        $or: [
            { folderName },
            { folderName: rawFolderName }
        ]
    };
    if (storageType && ['temp', 'permanent'].includes(storageType)) {
        query.storageType = storageType;
    }

    const files = await StashFile.find(query).lean();
    if (!files || files.length === 0) {
        throw new AppError('指定的文件夹不存在或已被删除', 404);
    }

    const stashDir = getStashDir();
    for (const file of files) {
        const filePath = path.join(stashDir, file.filename);
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        } catch (err) {
            console.error(`删除目录物理文件失败 (${file.filename}):`, err.message);
        }
    }

    await StashFile.deleteMany({ _id: { $in: files.map(f => f._id) } });

    res.status(200).json({
        code: 200,
        message: `文件夹【${folderName}】已删除（共清理 ${files.length} 个文件）`,
        data: { folderName, count: files.length }
    });
});

/**
 * 整文件夹打包流式下载（ZIP压缩实时推流，不占多余磁盘）
 */
exports.downloadFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.query.folderName;
    const folderName = fixEncoding(rawFolderName);
    const { storageType } = req.query;
    if (!folderName) {
        throw new AppError('请指定要下载的文件夹名称', 400);
    }

    const query = {
        userId: req.user._id,
        $or: [
            { folderName },
            { folderName: rawFolderName }
        ]
    };
    if (storageType && ['temp', 'permanent'].includes(storageType)) {
        query.storageType = storageType;
    }

    const files = await StashFile.find(query).lean();
    if (!files || files.length === 0) {
        throw new AppError('该文件夹内无有效文件或已过期', 404);
    }

    const stashDir = getStashDir();
    const archive = archiver('zip', {
        zlib: { level: 6 }
    });

    const safeName = encodeURIComponent(folderName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"; filename*=UTF-8''${safeName}.zip`);

    archive.on('error', err => {
        console.error('[DownloadFolder] ZIP 打包流异常:', err);
        if (!res.headersSent) {
            res.status(500).json({ code: 500, message: '打包下载文件夹失败' });
        }
    });

    archive.pipe(res);

    for (const file of files) {
        const filePath = path.join(stashDir, file.filename);
        if (fs.existsSync(filePath)) {
            const safeOriginal = fixEncoding(file.originalName);
            const safeRelative = fixEncoding(file.relativePath);
            const entryName = safeRelative || `${folderName}/${safeOriginal}`;
            archive.file(filePath, { name: entryName });
        }
    }

    await archive.finalize();
});

