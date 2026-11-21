const fs = require('fs');
const path = require('path');
const StashFile = require('../models/StashFile');
const QuickMemo = require('../models/QuickMemo');
const config = require('../config');
const { safeUnlink } = require('../utils/stashHelpers');

const TOMBSTONE_RETENTION_MS = 24 * 60 * 60 * 1000;

const execLean = queryOrRows => (
    queryOrRows && typeof queryOrRows.lean === 'function' ? queryOrRows.lean() : queryOrRows
);

const getStashDir = () => path.join(config.uploads.path, 'stash');

const ensureStashDir = () => {
    const dir = getStashDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

let activeCleanupPromise = null;
let timerId = null;

// 先物理删除磁盘附件，再将过期条目删库（StashFile）或置软删除墓碑（QuickMemo）
const runCleanup = async () => {
    try {
        const now = new Date();
        const stashDir = getStashDir();

        const expiredStashFiles = (await execLean(StashFile.find({
            storageType: 'temp',
            expireAt: { $lte: now }
        }))) || [];

        const cleanedStashIds = [];
        for (const file of expiredStashFiles) {
            const filePath = path.join(stashDir, path.basename(file.filename));
            if (await safeUnlink(filePath)) {
                cleanedStashIds.push(file._id);
            }
        }
        if (cleanedStashIds.length > 0) {
            await StashFile.deleteMany({ _id: { $in: cleanedStashIds } });
        }

        const expiredMemos = (await execLean(QuickMemo.find({
            storageType: 'temp',
            isDeleted: false,
            expireAt: { $lte: now }
        }))) || [];

        const cleanedMemoIds = [];
        for (const memo of expiredMemos) {
            const filename = memo.attachment?.filename;
            if (!filename || await safeUnlink(path.join(stashDir, path.basename(filename)))) {
                cleanedMemoIds.push(memo._id);
            }
        }
        if (cleanedMemoIds.length > 0) {
            await QuickMemo.updateMany(
                { _id: { $in: cleanedMemoIds }, isDeleted: false },
                { $set: { isDeleted: true, deletedAt: now, updatedAt: now } }
            );
        }

        // 定期彻底物理清除超过 24 小时的软删除墓碑，兼顾端侧增量感知与集合瘦身
        const purgeBefore = new Date(now.getTime() - TOMBSTONE_RETENTION_MS);
        const expiredTombstones = (await execLean(QuickMemo.find({
            isDeleted: true,
            deletedAt: { $lte: purgeBefore }
        }))) || [];

        const purgeIds = [];
        for (const tombstone of expiredTombstones) {
            const filename = tombstone.attachment?.filename;
            if (!filename || await safeUnlink(path.join(stashDir, path.basename(filename)))) {
                purgeIds.push(tombstone._id);
            }
        }
        if (purgeIds.length > 0) {
            await QuickMemo.deleteMany({ _id: { $in: purgeIds } });
        }

        const totalCleaned = cleanedStashIds.length + cleanedMemoIds.length;
        if (totalCleaned > 0) {
            console.log(`[StashCleanup] 已清理 ${cleanedStashIds.length} 个过期暂存文件与 ${cleanedMemoIds.length} 条过期随心记`);
        }

        return totalCleaned;
    } catch (error) {
        console.error('[StashCleanup] 过期文件清理任务异常:', error.message);
        return 0;
    }
};

const cleanupExpiredFiles = async () => {
    if (!activeCleanupPromise) {
        activeCleanupPromise = runCleanup().finally(() => {
            activeCleanupPromise = null;
        });
    }
    return activeCleanupPromise;
};

const startCleanupTimer = (intervalMs = 60000) => {
    ensureStashDir();
    cleanupExpiredFiles().catch(() => {});

    if (timerId) {
        clearInterval(timerId);
    }

    timerId = setInterval(() => {
        cleanupExpiredFiles().catch(() => {});
    }, intervalMs);

    console.log(`[StashCleanup] 文件暂存与随心记自动销毁引擎已启动 (巡检周期: ${intervalMs / 1000}s)`);
};

module.exports = {
    getStashDir,
    ensureStashDir,
    cleanupExpiredFiles,
    startCleanupTimer
};
