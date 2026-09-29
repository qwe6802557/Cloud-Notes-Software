const fs = require('fs');
const path = require('path');
const StashFile = require('../models/StashFile');
const config = require('../config');

/**
 * 获取暂存文件物理存储目录
 */
const getStashDir = () => {
    return path.join(config.uploads.path, 'stash');
};

/**
 * 确保暂存目录存在
 */
const ensureStashDir = () => {
    const dir = getStashDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

/**
 * 执行过期文件清理：彻底物理删除磁盘实体文件，并清理 MongoDB 记录
 */
const cleanupExpiredFiles = async () => {
    try {
        const now = new Date();
        const expiredFiles = await StashFile.find({
            storageType: 'temp',
            expireAt: { $lte: now }
        }).lean();

        if (!expiredFiles || expiredFiles.length === 0) {
            return 0;
        }

        const stashDir = getStashDir();
        const deleteIds = [];

        for (const file of expiredFiles) {
            deleteIds.push(file._id);
            const filePath = path.join(stashDir, file.filename);

            try {
                if (fs.existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                }
            } catch (err) {
                console.error(`[StashCleanup] 删除物理文件失败 (${file.filename}):`, err.message);
            }
        }

        if (deleteIds.length > 0) {
            await StashFile.deleteMany({ _id: { $in: deleteIds } });
            console.log(`[StashCleanup] 成功清理 ${deleteIds.length} 个过期临时暂存文件`);
        }

        return deleteIds.length;
    } catch (error) {
        console.error('[StashCleanup] 过期文件清理任务异常:', error.message);
        return 0;
    }
};

let timerId = null;

/**
 * 启动后台常驻定时清理引擎 (默认每 60 秒巡检一次)
 */
const startCleanupTimer = (intervalMs = 60000) => {
    ensureStashDir();

    // 启动即刻执行一次清理
    cleanupExpiredFiles().catch(() => {});

    if (timerId) {
        clearInterval(timerId);
    }

    timerId = setInterval(() => {
        cleanupExpiredFiles().catch(() => {});
    }, intervalMs);

    console.log(`[StashCleanup] 文件暂存自动销毁引擎已启动 (巡检周期: ${intervalMs / 1000}s)`);
};

module.exports = {
    getStashDir,
    ensureStashDir,
    cleanupExpiredFiles,
    startCleanupTimer
};
