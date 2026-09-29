const fs = require('fs');
const path = require('path');
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
 * 上传文件到暂存区 (支持 临时文件/永久文件)
 */
exports.uploadFile = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('请选择要上传的文件', 400);
    }

    const storageType = req.body.storageType === 'permanent' ? 'permanent' : 'temp';
    const expireAt = storageType === 'temp'
        ? new Date(Date.now() + 10 * 60 * 1000) // 严格 10 分钟后过期
        : null;

    const baseUrl = getFileUrl(req);
    const relativeUrl = `/uploads/stash/${req.file.filename}`;
    const fileUrl = `${baseUrl}${relativeUrl}`;
    const originalName = req.file.originalname || req.file.filename;

    const newFile = await StashFile.create({
        userId: req.user._id,
        filename: req.file.filename,
        originalName,
        size: req.file.size,
        mimetype: req.file.mimetype || 'application/octet-stream',
        storageType,
        expireAt,
        url: fileUrl
    });

    const remainingSeconds = storageType === 'temp'
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
        const remainingSeconds = file.storageType === 'temp' && file.expireAt
            ? Math.max(0, Math.floor((new Date(file.expireAt).getTime() - now) / 1000))
            : null;

        return {
            ...file,
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

    res.download(filePath, file.originalName);
});
