const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ZipArchive } = require('archiver');
const QuickMemo = require('../models/QuickMemo');
const StashFile = require('../models/StashFile');
const Note = require('../models/Note');
const Notebook = require('../models/Notebook');
const noteLinkService = require('../services/noteLinkService');
const { indexSingleNote } = require('../services/ragIndexService');
const { getStashDir, cleanupExpiredFiles } = require('../services/stashCleanupService');
const config = require('../config');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { computeNoteContentHash } = require('../utils/noteHash');
const {
    fixEncoding,
    getBaseUrl,
    safeUnlink,
    sanitizeRelativePath,
    normalizeZipEntryPath,
    buildZipDownloadHeaders,
    isImageAttachment,
    extractHttpLinks
} = require('../utils/stashHelpers');

const MAX_TEMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const execLean = queryOrRows => (
    queryOrRows && typeof queryOrRows.lean === 'function' ? queryOrRows.lean() : queryOrRows
);

const parsePositiveTtlMinutes = (value, fallback) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, 7 * 24 * 60);
};

// 将临时条目到期时间统一钳制在 (now, now + 7天] 范围内，防止畸形 batchExpireAt 或无限续期绕过配额
const clampTempExpireAt = (candidateDate, nowMs, fallbackMinutes = config.quickNotes.defaultTtlMinutes) => {
    const maxExpireMs = nowMs + MAX_TEMP_TTL_MS;
    if (!candidateDate || Number.isNaN(candidateDate.getTime()) || candidateDate.getTime() <= nowMs) {
        return new Date(Math.min(nowMs + fallbackMinutes * 60 * 1000, maxExpireMs));
    }
    return new Date(Math.min(candidateDate.getTime(), maxExpireMs));
};

const getMemoStorageBytes = memo => {
    if (memo?.attachment && Number.isFinite(Number(memo.attachment.size))) {
        return Math.max(0, Number(memo.attachment.size));
    }
    return Buffer.byteLength(memo?.content || '', 'utf8');
};

const isExpiredDoc = (doc, nowMs) => (
    doc.storageType === 'temp' && doc.expireAt && new Date(doc.expireAt).getTime() <= nowMs
);

const formatQuickMemoDto = (memo, nowMs = Date.now()) => {
    const idStr = String(memo._id);
    const expireAtIso = memo.expireAt ? new Date(memo.expireAt).toISOString() : null;
    const remainingSeconds = memo.storageType === 'temp' && memo.expireAt && !memo.isDeleted
        ? Math.max(0, Math.floor((new Date(memo.expireAt).getTime() - nowMs) / 1000))
        : null;

    const attachment = memo.attachment
        ? {
            filename: memo.attachment.filename,
            originalName: fixEncoding(memo.attachment.originalName),
            relativePath: fixEncoding(memo.attachment.relativePath || ''),
            folderName: fixEncoding(memo.attachment.folderName || ''),
            size: Number(memo.attachment.size) || 0,
            mimetype: memo.attachment.mimetype || 'application/octet-stream',
            url: memo.attachment.url
        }
        : null;

    return {
        _id: idStr,
        id: idStr,
        kind: memo.kind,
        content: memo.content || '',
        links: Array.isArray(memo.links)
            ? memo.links.map(l => ({ url: l.url, host: l.host || '' }))
            : [],
        attachment,
        storageType: memo.storageType,
        expireAt: expireAtIso,
        remainingSeconds,
        convertedNoteId: memo.convertedNoteId ? String(memo.convertedNoteId) : null,
        isDeleted: Boolean(memo.isDeleted),
        createdAt: memo.createdAt,
        updatedAt: memo.updatedAt
    };
};

const formatLegacyStashDto = (file, nowMs = Date.now()) => {
    const idStr = String(file._id);
    const originalName = fixEncoding(file.originalName);
    const relativePath = fixEncoding(file.relativePath || '');
    const folderName = fixEncoding(file.folderName || '');
    const expireAtIso = file.expireAt ? new Date(file.expireAt).toISOString() : null;
    const remainingSeconds = file.storageType === 'temp' && file.expireAt
        ? Math.max(0, Math.floor((new Date(file.expireAt).getTime() - nowMs) / 1000))
        : null;

    return {
        _id: idStr,
        id: idStr,
        kind: isImageAttachment(file.mimetype, originalName) ? 'image' : 'file',
        content: '',
        links: [],
        attachment: {
            filename: file.filename,
            originalName,
            relativePath,
            folderName,
            size: Number(file.size) || 0,
            mimetype: file.mimetype || 'application/octet-stream',
            url: file.url
        },
        storageType: file.storageType,
        expireAt: expireAtIso,
        remainingSeconds,
        convertedNoteId: file.convertedNoteId ? String(file.convertedNoteId) : null,
        legacySource: 'stash',
        isDeleted: false,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt
    };
};

const summarizeCountsAndQuota = (memoRows = [], stashRows = []) => {
    let temp = 0;
    let permanent = 0;
    let permanentUsedBytes = 0;

    for (const m of memoRows) {
        if (m.storageType === 'permanent') {
            permanent += 1;
            permanentUsedBytes += getMemoStorageBytes(m);
        } else {
            temp += 1;
        }
    }

    for (const s of stashRows) {
        if (s.storageType === 'permanent') {
            permanent += 1;
            permanentUsedBytes += Math.max(0, Number(s.size) || 0);
        } else {
            temp += 1;
        }
    }

    return {
        counts: {
            all: temp + permanent,
            temp,
            permanent
        },
        quota: {
            permanentUsedBytes,
            permanentLimitBytes: config.quickNotes.permanentQuotaBytes
        }
    };
};

// 统计当前用户全部有效随心记与存量暂存文件分区数量及永久区配额占用
const computeCountsAndQuota = async (userId, now, prefetchedStashRows = null) => {
    const activeExpiryFilter = { $or: [{ storageType: 'permanent' }, { expireAt: { $gt: now } }] };
    const [memoRows, stashRows] = await Promise.all([
        execLean(
            QuickMemo.find({ userId, isDeleted: false, ...activeExpiryFilter })
                .select('storageType content attachment.size')
        ),
        prefetchedStashRows !== null
            ? Promise.resolve(prefetchedStashRows)
            : execLean(
                StashFile.find({ userId, ...activeExpiryFilter })
                    .select('storageType size')
            )
    ]);

    return summarizeCountsAndQuota(memoRows || [], stashRows || []);
};

const assertPermanentQuotaAvailable = async (userId, addingBytes, now) => {
    const { quota } = await computeCountsAndQuota(userId, now);
    if (quota.permanentUsedBytes + addingBytes > quota.permanentLimitBytes) {
        throw new AppError('永久随心记空间已超出 2GB 上限，请清理部分永久条目或改用临时发送', 413);
    }
};

const deriveNoteTitle = (requestedTitle, memoOrStash) => {
    if (typeof requestedTitle === 'string' && requestedTitle.trim()) {
        return requestedTitle.trim().slice(0, 200);
    }

    const attachmentName = memoOrStash.attachment?.originalName || memoOrStash.originalName;
    if (attachmentName) {
        return fixEncoding(attachmentName).slice(0, 200);
    }

    const firstLine = String(memoOrStash.content || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean);
    if (firstLine) {
        return firstLine.slice(0, 40);
    }

    return '随心记转存笔记';
};

// 获取随心记统一时间线流（合并活跃 QuickMemo 与存量 StashFile，按创建时间升序返回）
exports.listQuickNotes = asyncHandler(async (req, res) => {
    await cleanupExpiredFiles();

    const userId = req.user._id;
    const { type, kind, limit } = req.query;

    if (type !== undefined && type !== '' && !['temp', 'permanent'].includes(type)) {
        throw new AppError('无效的存储类型筛选参数', 400);
    }
    if (kind !== undefined && kind !== '' && !['text', 'link', 'image', 'file'].includes(kind)) {
        throw new AppError('无效的内容类型筛选参数', 400);
    }

    const rawLimit = parseInt(limit, 10);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    const now = new Date();
    const nowMs = now.getTime();
    const serverTime = now.toISOString();
    const activeExpiryFilter = { $or: [{ storageType: 'permanent' }, { expireAt: { $gt: now } }] };

    const memoQuery = { userId, isDeleted: false, ...activeExpiryFilter };
    if (type) memoQuery.storageType = type;
    if (kind) memoQuery.kind = kind;

    const shouldQueryStash = !kind || kind === 'image' || kind === 'file';
    const stashQuery = { userId, ...activeExpiryFilter };
    if (type) stashQuery.storageType = type;

    const isUnfiltered = !type && !kind;
    const [memoDocs, stashDocs, summary] = await Promise.all([
        execLean(QuickMemo.find(memoQuery).sort({ createdAt: 1, _id: 1 })),
        shouldQueryStash ? execLean(StashFile.find(stashQuery).sort({ createdAt: 1, _id: 1 })) : Promise.resolve([]),
        isUnfiltered ? Promise.resolve(null) : computeCountsAndQuota(userId, now)
    ]);

    const resolvedSummary = summary || summarizeCountsAndQuota(memoDocs || [], stashDocs || []);

    const mappedMemos = (memoDocs || []).map(doc => formatQuickMemoDto(doc, nowMs));
    let mappedStash = (stashDocs || []).map(doc => formatLegacyStashDto(doc, nowMs));
    if (kind === 'image' || kind === 'file') {
        mappedStash = mappedStash.filter(item => item.kind === kind);
    }

    const merged = [...mappedMemos, ...mappedStash].sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff !== 0 ? diff : String(a._id).localeCompare(String(b._id));
    });

    const items = merged.length > safeLimit ? merged.slice(merged.length - safeLimit) : merged;

    let latestMemoDoc = null;
    for (const doc of (memoDocs || [])) {
        if (!latestMemoDoc) {
            latestMemoDoc = doc;
            continue;
        }
        const docTime = new Date(doc.updatedAt).getTime();
        const latestTime = new Date(latestMemoDoc.updatedAt).getTime();
        if (docTime > latestTime || (docTime === latestTime && String(doc._id) > String(latestMemoDoc._id))) {
            latestMemoDoc = doc;
        }
    }

    const nextCursor = latestMemoDoc
        ? { since: new Date(latestMemoDoc.updatedAt).toISOString(), cursorId: String(latestMemoDoc._id) }
        : { since: serverTime, cursorId: null };

    res.status(200).json({
        code: 200,
        message: '获取随心记列表成功',
        data: {
            items,
            counts: resolvedSummary.counts,
            quota: resolvedSummary.quota,
            serverTime,
            nextCursor
        }
    });
});

// 随心记增量游标同步（含软删除墓碑与存量活跃 StashFile 一致性列表）
exports.deltaQuickNotes = asyncHandler(async (req, res) => {
    await cleanupExpiredFiles();

    const userId = req.user._id;
    const { since, cursorId, limit } = req.query;

    const rawLimit = parseInt(limit, 10);
    const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

    const now = new Date();
    const nowMs = now.getTime();
    const serverTime = now.toISOString();

    const memoQuery = { userId };
    if (since) {
        const sinceDate = new Date(since);
        if (Number.isNaN(sinceDate.getTime())) {
            throw new AppError('无效的增量同步时间游标', 400);
        }
        if (cursorId && mongoose.Types.ObjectId.isValid(cursorId)) {
            const cursorObjectId = new mongoose.Types.ObjectId(cursorId);
            memoQuery.$or = [
                { updatedAt: { $gt: sinceDate } },
                { updatedAt: sinceDate, _id: { $gt: cursorObjectId } }
            ];
        } else {
            memoQuery.updatedAt = { $gt: sinceDate };
        }
    }

    const activeStashQuery = {
        userId,
        $or: [{ storageType: 'permanent' }, { expireAt: { $gt: now } }]
    };

    const [memoDocs, stashDocs] = await Promise.all([
        execLean(QuickMemo.find(memoQuery).sort({ updatedAt: 1, _id: 1 }).limit(safeLimit + 1)),
        execLean(StashFile.find(activeStashQuery).sort({ createdAt: 1, _id: 1 }))
    ]);
    const summary = await computeCountsAndQuota(userId, now, stashDocs || []);

    const rawDocs = memoDocs || [];
    const hasMore = rawDocs.length > safeLimit;
    const pageDocs = hasMore ? rawDocs.slice(0, safeLimit) : rawDocs;

    const items = pageDocs.map(doc => formatQuickMemoDto(doc, nowMs));
    const legacyItems = (stashDocs || []).map(doc => formatLegacyStashDto(doc, nowMs));

    const lastDoc = pageDocs.length > 0 ? pageDocs[pageDocs.length - 1] : null;
    const nextCursor = lastDoc
        ? { since: new Date(lastDoc.updatedAt).toISOString(), cursorId: String(lastDoc._id) }
        : null;

    res.status(200).json({
        code: 200,
        message: '获取随心记增量同步成功',
        data: {
            items,
            legacyItems,
            counts: summary.counts,
            quota: summary.quota,
            serverTime,
            nextCursor,
            hasMore
        }
    });
});

// 发送文本/链接随心记（支持 clientId 幂等防重发与 50KB 上限）
exports.createTextMemo = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { content, storageType: rawStorageType, ttlMinutes, clientId } = req.body || {};

    if (typeof content !== 'string' || !content.trim()) {
        throw new AppError('发送内容不能为空', 400);
    }

    const textBytes = Buffer.byteLength(content, 'utf8');
    if (textBytes > config.quickNotes.maxTextLength) {
        throw new AppError('单条随心记文本不能超过 50KB', 400);
    }

    const storageType = rawStorageType === 'permanent' ? 'permanent' : 'temp';
    const normalizedClientId = typeof clientId === 'string' && clientId.trim() ? clientId.trim() : null;

    if (normalizedClientId) {
        const existing = await QuickMemo.findOne({ userId, clientId: normalizedClientId, isDeleted: false });
        if (existing) {
            return res.status(200).json({
                code: 200,
                message: '随心记已存在',
                data: formatQuickMemoDto(existing)
            });
        }
    }

    const now = new Date();
    if (storageType === 'permanent') {
        await assertPermanentQuotaAvailable(userId, textBytes, now);
    }

    const links = extractHttpLinks(content);
    const kind = links.length > 0 ? 'link' : 'text';
    const safeTtlMinutes = parsePositiveTtlMinutes(ttlMinutes, config.quickNotes.defaultTtlMinutes);
    const expireAt = storageType === 'temp' ? new Date(now.getTime() + safeTtlMinutes * 60 * 1000) : null;

    let memo;
    try {
        memo = await QuickMemo.create({
            userId,
            kind,
            content,
            links,
            attachment: null,
            storageType,
            expireAt,
            clientId: normalizedClientId,
            isDeleted: false
        });
    } catch (err) {
        if (err && err.code === 11000 && normalizedClientId) {
            const duplicated = await QuickMemo.findOne({ userId, clientId: normalizedClientId, isDeleted: false });
            if (duplicated) {
                return res.status(200).json({
                    code: 200,
                    message: '随心记已存在',
                    data: formatQuickMemoDto(duplicated)
                });
            }
        }
        throw err;
    }

    res.status(201).json({
        code: 200,
        message: storageType === 'temp' ? `已发送临时随心记（${safeTtlMinutes}分钟后自动清除）` : '已永久保存随心记',
        data: formatQuickMemoDto(memo)
    });
});

// 上传图片/文件/文件夹子文件到随心记
exports.uploadFileMemo = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('请选择要上传的文件', 400);
    }

    const userId = req.user._id;
    const uploadedPath = req.file.path || path.join(getStashDir(), path.basename(req.file.filename));

    try {
        const {
            storageType: rawStorageType,
            ttlMinutes,
            batchExpireAt,
            relativePath: rawRelativePath,
            folderName: rawFolderName,
            originalName: rawOriginalName,
            content: rawContent,
            clientId
        } = req.body || {};

        const normalizedClientId = typeof clientId === 'string' && clientId.trim() ? clientId.trim() : null;
        if (normalizedClientId) {
            const existing = await QuickMemo.findOne({ userId, clientId: normalizedClientId, isDeleted: false });
            if (existing) {
                await safeUnlink(uploadedPath);
                return res.status(200).json({
                    code: 200,
                    message: '随心记文件已存在',
                    data: formatQuickMemoDto(existing)
                });
            }
        }

        const caption = typeof rawContent === 'string' ? rawContent : '';
        if (caption && Buffer.byteLength(caption, 'utf8') > config.quickNotes.maxTextLength) {
            throw new AppError('附言文本不能超过 50KB', 400);
        }

        const storageType = rawStorageType === 'permanent' ? 'permanent' : 'temp';
        const now = new Date();
        if (storageType === 'permanent') {
            await assertPermanentQuotaAvailable(userId, Number(req.file.size) || 0, now);
        }

        const safeTtlMinutes = parsePositiveTtlMinutes(ttlMinutes, config.quickNotes.defaultTtlMinutes);
        const nowMs = now.getTime();
        let expireAt = null;
        if (storageType === 'temp') {
            expireAt = batchExpireAt
                ? clampTempExpireAt(new Date(batchExpireAt), nowMs, safeTtlMinutes)
                : clampTempExpireAt(null, nowMs, safeTtlMinutes);
        }

        const relativePath = sanitizeRelativePath(rawRelativePath);
        let folderName = sanitizeRelativePath(rawFolderName).split('/')[0] || '';
        if (!folderName && relativePath.includes('/')) {
            folderName = relativePath.split('/')[0];
        }

        let originalName = (rawOriginalName || '').trim();
        if (!originalName && req.file.originalname) {
            originalName = fixEncoding(req.file.originalname);
        }
        if (!originalName) {
            originalName = req.file.filename;
        }

        const mimetype = req.file.mimetype || 'application/octet-stream';
        const kind = isImageAttachment(mimetype, originalName) ? 'image' : 'file';
        const fileUrl = `${getBaseUrl(req)}/uploads/stash/${req.file.filename}`;
        const links = caption ? extractHttpLinks(caption) : [];

        let memo;
        try {
            memo = await QuickMemo.create({
                userId,
                kind,
                content: caption,
                links,
                attachment: {
                    filename: req.file.filename,
                    originalName,
                    relativePath,
                    folderName,
                    size: req.file.size,
                    mimetype,
                    url: fileUrl
                },
                storageType,
                expireAt,
                clientId: normalizedClientId,
                isDeleted: false
            });
        } catch (err) {
            if (err && err.code === 11000 && normalizedClientId) {
                const duplicated = await QuickMemo.findOne({ userId, clientId: normalizedClientId, isDeleted: false });
                if (duplicated) {
                    await safeUnlink(uploadedPath);
                    return res.status(200).json({
                        code: 200,
                        message: '随心记文件已存在',
                        data: formatQuickMemoDto(duplicated)
                    });
                }
            }
            throw err;
        }

        return res.status(201).json({
            code: 200,
            message: storageType === 'temp' ? `文件已发送（${safeTtlMinutes}分钟后自动清除）` : '永久文件已发送',
            data: formatQuickMemoDto(memo)
        });
    } catch (err) {
        await safeUnlink(uploadedPath);
        throw err;
    }
});

// 将临时随心记原子转为永久保留（兼容旧 StashFile）
exports.promoteMemo = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('无效的随心记 ID', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const nowMs = now.getTime();

    const memo = await QuickMemo.findOne({ _id: id, userId, isDeleted: false });
    if (memo) {
        if (isExpiredDoc(memo, nowMs)) {
            throw new AppError('该条目不存在或已过期清理', 404);
        }
        if (memo.storageType === 'permanent') {
            return res.status(200).json({
                code: 200,
                message: '该随心记已经是永久保留状态',
                data: formatQuickMemoDto(memo, nowMs)
            });
        }

        await assertPermanentQuotaAvailable(userId, getMemoStorageBytes(memo), now);

        const updated = await QuickMemo.findOneAndUpdate(
            {
                _id: id,
                userId,
                isDeleted: false,
                $or: [{ storageType: 'permanent' }, { expireAt: { $gt: now } }]
            },
            { $set: { storageType: 'permanent', expireAt: null } },
            { new: true }
        );

        if (!updated) {
            throw new AppError('该条目不存在或已过期清理', 404);
        }

        return res.status(200).json({
            code: 200,
            message: '已转为永久保留',
            data: formatQuickMemoDto(updated, nowMs)
        });
    }

    const legacy = await StashFile.findOne({ _id: id, userId });
    if (!legacy || isExpiredDoc(legacy, nowMs)) {
        throw new AppError('该条目不存在或已过期清理', 404);
    }

    if (legacy.storageType === 'permanent') {
        return res.status(200).json({
            code: 200,
            message: '该文件已经是永久保存文件',
            data: formatLegacyStashDto(legacy, nowMs)
        });
    }

    await assertPermanentQuotaAvailable(userId, Number(legacy.size) || 0, now);

    const updatedLegacy = await StashFile.findOneAndUpdate(
        {
            _id: id,
            userId,
            $or: [{ storageType: 'permanent' }, { expireAt: { $gt: now } }]
        },
        { $set: { storageType: 'permanent', expireAt: null } },
        { new: true }
    );

    if (!updatedLegacy) {
        throw new AppError('该条目不存在或已过期清理', 404);
    }

    return res.status(200).json({
        code: 200,
        message: '已转为永久保留',
        data: formatLegacyStashDto(updatedLegacy, nowMs)
    });
});

// 临时随心记续期（默认延长 20 分钟，兼容旧 StashFile）
exports.extendMemo = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('无效的随心记 ID', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const nowMs = now.getTime();
    const extendMinutes = parsePositiveTtlMinutes(req.body?.ttlMinutes, config.quickNotes.defaultTtlMinutes);

    const memo = await QuickMemo.findOne({ _id: id, userId, isDeleted: false });
    if (memo) {
        if (memo.storageType === 'permanent') {
            throw new AppError('永久保留条目无需续期', 400);
        }
        if (isExpiredDoc(memo, nowMs)) {
            throw new AppError('该条目不存在或已过期清理', 404);
        }

        const baseMs = Math.max(nowMs, memo.expireAt ? new Date(memo.expireAt).getTime() : nowMs);
        const nextExpireAt = clampTempExpireAt(new Date(baseMs + extendMinutes * 60 * 1000), nowMs, extendMinutes);

        const updated = await QuickMemo.findOneAndUpdate(
            { _id: id, userId, isDeleted: false, storageType: 'temp', expireAt: { $gt: now } },
            { $set: { expireAt: nextExpireAt } },
            { new: true }
        );

        if (!updated) {
            throw new AppError('该条目不存在或已过期清理', 404);
        }

        return res.status(200).json({
            code: 200,
            message: `已续期 ${extendMinutes} 分钟`,
            data: formatQuickMemoDto(updated, nowMs)
        });
    }

    const legacy = await StashFile.findOne({ _id: id, userId });
    if (!legacy) {
        throw new AppError('该条目不存在或已过期清理', 404);
    }
    if (legacy.storageType === 'permanent') {
        throw new AppError('永久保留条目无需续期', 400);
    }
    if (isExpiredDoc(legacy, nowMs)) {
        throw new AppError('该条目不存在或已过期清理', 404);
    }

    const baseMs = Math.max(nowMs, legacy.expireAt ? new Date(legacy.expireAt).getTime() : nowMs);
    const nextExpireAt = clampTempExpireAt(new Date(baseMs + extendMinutes * 60 * 1000), nowMs, extendMinutes);

    const updatedLegacy = await StashFile.findOneAndUpdate(
        { _id: id, userId, storageType: 'temp', expireAt: { $gt: now } },
        { $set: { expireAt: nextExpireAt } },
        { new: true }
    );

    if (!updatedLegacy) {
        throw new AppError('该条目不存在或已过期清理', 404);
    }

    return res.status(200).json({
        code: 200,
        message: `已续期 ${extendMinutes} 分钟`,
        data: formatLegacyStashDto(updatedLegacy, nowMs)
    });
});

// 删除随心记（软删 QuickMemo 置墓碑同步其他端，联动清理磁盘物理文件）
exports.deleteMemo = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('无效的随心记 ID', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const stashDir = getStashDir();

    const memo = await QuickMemo.findOne({ _id: id, userId, isDeleted: false });
    if (memo) {
        if (memo.attachment?.filename) {
            await safeUnlink(path.join(stashDir, path.basename(memo.attachment.filename)));
        }
        await QuickMemo.updateOne(
            { _id: id, userId, isDeleted: false },
            { $set: { isDeleted: true, deletedAt: now, updatedAt: now } }
        );
        return res.status(200).json({
            code: 200,
            message: '随心记已删除',
            data: { id }
        });
    }

    const legacy = await StashFile.findOne({ _id: id, userId });
    if (legacy) {
        await safeUnlink(path.join(stashDir, path.basename(legacy.filename)));
        await StashFile.deleteOne({ _id: id, userId });
        return res.status(200).json({
            code: 200,
            message: '文件已删除',
            data: { id }
        });
    }

    throw new AppError('指定的随心记不存在', 404);
});

// 一键将随心记转存为正式笔记（自动拷贝临时附件到 uploads/notes/ 防断图，保留原随心记并写入 convertedNoteId）
exports.convertToNote = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new AppError('无效的随心记 ID', 400);
    }

    const { notebookId, title } = req.body || {};
    if (notebookId && !mongoose.Types.ObjectId.isValid(notebookId)) {
        throw new AppError('无效的目标笔记本 ID', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const nowMs = now.getTime();

    const memo = await QuickMemo.findOne({ _id: id, userId, isDeleted: false });
    const legacy = !memo ? await StashFile.findOne({ _id: id, userId }) : null;
    const source = memo || legacy;

    if (!source || isExpiredDoc(source, nowMs)) {
        throw new AppError('随心记不存在或已过期清理', 404);
    }

    let targetNotebook = null;
    if (notebookId) {
        targetNotebook = await Notebook.findOne({ _id: notebookId, userId, isDeleted: false });
        if (!targetNotebook) {
            throw new AppError('目标笔记本不存在', 404);
        }
    } else {
        targetNotebook = await Notebook.findOne({ userId, isDefault: true, isDeleted: false });
        if (!targetNotebook) {
            targetNotebook = await Notebook.findOne({ userId, isDeleted: false }).sort({ sort: 1, createdAt: 1 });
        }
        if (!targetNotebook) {
            throw new AppError('未找到可用笔记本，请先创建笔记本', 400);
        }
    }

    if (targetNotebook.isEncrypted) {
        throw new AppError('加密笔记本不支持服务端直接转存，请先转存至普通笔记本', 400);
    }

    const sourceAttachment = memo
        ? memo.attachment
        : {
            filename: legacy.filename,
            originalName: legacy.originalName,
            mimetype: legacy.mimetype
        };

    let copiedDestPath = null;
    let noteContent = memo ? (memo.content || '') : '';

    if (sourceAttachment && sourceAttachment.filename) {
        const srcFilename = path.basename(sourceAttachment.filename);
        const srcPath = path.join(getStashDir(), srcFilename);
        const notesDir = path.join(config.uploads.path, 'notes');
        await fs.promises.mkdir(notesDir, { recursive: true });

        const originalName = fixEncoding(sourceAttachment.originalName || srcFilename);
        const ext = path.extname(srcFilename) || path.extname(originalName) || '';
        const destFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        copiedDestPath = path.join(notesDir, destFilename);

        try {
            await fs.promises.copyFile(srcPath, copiedDestPath);
        } catch (err) {
            if (err && err.code === 'ENOENT') {
                throw new AppError('源附件文件不存在或已过期清理，无法转存', 404);
            }
            throw err;
        }

        const noteMediaUrl = `${getBaseUrl(req)}/uploads/notes/${destFilename}`;
        const safeLabel = originalName.replace(/[\[\]\r\n]/g, '_');
        const mediaMarkdown = isImageAttachment(sourceAttachment.mimetype, originalName)
            ? `![${safeLabel}](${noteMediaUrl})`
            : `[${safeLabel}](${noteMediaUrl})`;

        noteContent = noteContent.trim()
            ? `${mediaMarkdown}\n\n${noteContent}`
            : mediaMarkdown;
    }

    const noteTitle = deriveNoteTitle(title, source);
    const contentHash = computeNoteContentHash({
        title: noteTitle,
        content: noteContent,
        isEncrypted: false,
        encryptedData: null
    });

    let createdNote;
    try {
        createdNote = await Note.create({
            title: noteTitle,
            content: noteContent,
            rawContent: noteContent,
            notebookId: targetNotebook._id,
            userId,
            type: 'note',
            parentId: null,
            tags: [],
            isEncrypted: false,
            encryptedData: null,
            contentVersion: 1,
            contentUpdatedAt: now,
            contentHash
        });
    } catch (err) {
        if (copiedDestPath) {
            await safeUnlink(copiedDestPath);
        }
        throw err;
    }

    if (createdNote.content) {
        const linkResult = await noteLinkService.syncNoteLinks(userId, createdNote._id, createdNote.content, []);
        createdNote.outlinks = linkResult.outlinks;
        createdNote.unresolvedLinks = linkResult.unresolvedLinks;
        if (typeof createdNote.save === 'function') {
            await createdNote.save({ validateBeforeSave: false });
        }
        await noteLinkService.resolveUnresolvedBacklinksOnTitleChange(userId, createdNote);
    }

    let formattedMemo;
    if (memo) {
        const updatedMemo = await QuickMemo.findOneAndUpdate(
            { _id: id, userId, isDeleted: false },
            { $set: { convertedNoteId: createdNote._id } },
            { new: true }
        );
        const baseMemo = typeof memo.toObject === 'function' ? memo.toObject() : memo;
        formattedMemo = formatQuickMemoDto(updatedMemo || { ...baseMemo, convertedNoteId: createdNote._id }, nowMs);
    } else {
        const updatedLegacy = await StashFile.findOneAndUpdate(
            { _id: id, userId },
            { $set: { convertedNoteId: createdNote._id } },
            { new: true }
        );
        const baseLegacy = typeof legacy.toObject === 'function' ? legacy.toObject() : legacy;
        formattedMemo = formatLegacyStashDto(updatedLegacy || { ...baseLegacy, convertedNoteId: createdNote._id }, nowMs);
    }

    res.status(200).json({
        code: 200,
        message: '已转存为正式笔记',
        data: {
            note: createdNote,
            memo: formattedMemo
        }
    });

    indexSingleNote(createdNote._id, req.user).catch(() => {});
});

// 临时文件夹一键转为永久保存（兼容 QuickMemo 与存量 StashFile）
exports.promoteFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.body?.folderName;
    const folderName = fixEncoding(rawFolderName);
    if (!folderName) {
        throw new AppError('请指定要转永久的文件夹名称', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const memoQuery = {
        userId,
        isDeleted: false,
        storageType: 'temp',
        $and: [
            { $or: [{ 'attachment.folderName': folderName }, { 'attachment.folderName': rawFolderName }] },
            { $or: [{ expireAt: { $gt: now } }, { expireAt: null }] }
        ]
    };
    const stashQuery = {
        userId,
        storageType: 'temp',
        $and: [
            { $or: [{ folderName }, { folderName: rawFolderName }] },
            { $or: [{ expireAt: { $gt: now } }, { expireAt: null }] }
        ]
    };

    const [memoDocs, stashDocs] = await Promise.all([
        execLean(QuickMemo.find(memoQuery).select('_id attachment.size content')),
        execLean(StashFile.find(stashQuery).select('_id size'))
    ]);

    const memos = memoDocs || [];
    const stashes = stashDocs || [];
    const totalCount = memos.length + stashes.length;

    if (totalCount === 0) {
        throw new AppError('指定的文件夹不存在或已过期销毁', 404);
    }

    const addingBytes = memos.reduce((sum, m) => sum + getMemoStorageBytes(m), 0)
        + stashes.reduce((sum, s) => sum + Math.max(0, Number(s.size) || 0), 0);

    await assertPermanentQuotaAvailable(userId, addingBytes, now);

    const ops = [];
    if (memos.length > 0) {
        ops.push(QuickMemo.updateMany(
            { _id: { $in: memos.map(m => m._id) }, userId, isDeleted: false },
            { $set: { storageType: 'permanent', 'attachment.folderName': folderName, expireAt: null } }
        ));
    }
    if (stashes.length > 0) {
        ops.push(StashFile.updateMany(
            { _id: { $in: stashes.map(s => s._id) }, userId },
            { $set: { storageType: 'permanent', folderName, expireAt: null } }
        ));
    }
    await Promise.all(ops);

    res.status(200).json({
        code: 200,
        message: `文件夹【${folderName}】内共 ${totalCount} 个文件已全部转为永久保存`,
        data: { folderName, count: totalCount }
    });
});

// 彻底删除整个文件夹及其物理文件（兼容 QuickMemo 与存量 StashFile）
exports.deleteFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.body?.folderName || req.query?.folderName;
    const folderName = fixEncoding(rawFolderName);
    const storageType = req.body?.storageType || req.query?.storageType;

    if (!folderName) {
        throw new AppError('请指定要删除的文件夹名称', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const memoQuery = {
        userId,
        isDeleted: false,
        $or: [{ 'attachment.folderName': folderName }, { 'attachment.folderName': rawFolderName }]
    };
    const stashQuery = {
        userId,
        $or: [{ folderName }, { folderName: rawFolderName }]
    };

    if (storageType && ['temp', 'permanent'].includes(storageType)) {
        memoQuery.storageType = storageType;
        stashQuery.storageType = storageType;
    }

    const [memoDocs, stashDocs] = await Promise.all([
        execLean(QuickMemo.find(memoQuery)),
        execLean(StashFile.find(stashQuery))
    ]);

    const memos = memoDocs || [];
    const stashes = stashDocs || [];
    const totalCount = memos.length + stashes.length;

    if (totalCount === 0) {
        throw new AppError('指定的文件夹不存在或已被删除', 404);
    }

    const stashDir = getStashDir();
    for (const m of memos) {
        if (m.attachment?.filename) {
            await safeUnlink(path.join(stashDir, path.basename(m.attachment.filename)));
        }
    }
    for (const s of stashes) {
        await safeUnlink(path.join(stashDir, path.basename(s.filename)));
    }

    const ops = [];
    if (memos.length > 0) {
        ops.push(QuickMemo.updateMany(
            { _id: { $in: memos.map(m => m._id) }, userId, isDeleted: false },
            { $set: { isDeleted: true, deletedAt: now, updatedAt: now } }
        ));
    }
    if (stashes.length > 0) {
        ops.push(StashFile.deleteMany({ _id: { $in: stashes.map(s => s._id) }, userId }));
    }
    await Promise.all(ops);

    res.status(200).json({
        code: 200,
        message: `文件夹【${folderName}】已删除（共清理 ${totalCount} 个文件）`,
        data: { folderName, count: totalCount }
    });
});

// 整文件夹流式 ZIP 打包下载（兼容 QuickMemo 与存量 StashFile）
exports.downloadFolder = asyncHandler(async (req, res) => {
    const rawFolderName = req.query.folderName;
    const folderName = fixEncoding(rawFolderName);
    const { storageType } = req.query;

    if (!folderName) {
        throw new AppError('请指定要下载的文件夹名称', 400);
    }

    const userId = req.user._id;
    const now = new Date();
    const activeExpiry = [{ expireAt: { $gt: now } }, { storageType: 'permanent' }];

    const memoQuery = {
        userId,
        isDeleted: false,
        $and: [
            { $or: [{ 'attachment.folderName': folderName }, { 'attachment.folderName': rawFolderName }] },
            { $or: activeExpiry }
        ]
    };
    const stashQuery = {
        userId,
        $and: [
            { $or: [{ folderName }, { folderName: rawFolderName }] },
            { $or: activeExpiry }
        ]
    };

    if (storageType && ['temp', 'permanent'].includes(storageType)) {
        memoQuery.storageType = storageType;
        stashQuery.storageType = storageType;
    }

    const [memoDocs, stashDocs] = await Promise.all([
        execLean(QuickMemo.find(memoQuery)),
        execLean(StashFile.find(stashQuery))
    ]);

    const entries = [
        ...(memoDocs || [])
            .filter(m => m.attachment?.filename)
            .map(m => ({
                id: String(m._id),
                filename: m.attachment.filename,
                originalName: m.attachment.originalName,
                relativePath: m.attachment.relativePath
            })),
        ...(stashDocs || []).map(s => ({
            id: String(s._id),
            filename: s.filename,
            originalName: s.originalName,
            relativePath: s.relativePath
        }))
    ];

    if (entries.length === 0) {
        throw new AppError('该文件夹内无有效文件或已过期', 404);
    }

    const stashDir = getStashDir();
    const archive = new ZipArchive({
        zlib: { level: 6 }
    });

    buildZipDownloadHeaders(res, folderName);

    archive.on('error', err => {
        console.error('[QuickNoteDownloadFolder] ZIP 打包流异常:', err);
        if (!res.headersSent) {
            res.status(500).json({ code: 500, message: '打包下载文件夹失败' });
        }
    });

    archive.pipe(res);

    const usedEntryNames = new Set();
    for (const item of entries) {
        const filePath = path.join(stashDir, path.basename(item.filename));
        if (fs.existsSync(filePath)) {
            const safeOriginal = fixEncoding(item.originalName);
            const safeRelative = fixEncoding(item.relativePath);
            let entryName = normalizeZipEntryPath(safeRelative || `${folderName}/${safeOriginal}`, safeOriginal);
            if (usedEntryNames.has(entryName)) {
                entryName = `${item.id}-${entryName}`;
            }
            usedEntryNames.add(entryName);
            archive.file(filePath, { name: entryName });
        }
    }

    await archive.finalize();
});
