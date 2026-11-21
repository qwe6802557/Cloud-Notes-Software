const { describe, it, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);

const config = require('../src/config');
const QuickMemo = require('../src/models/QuickMemo');
const StashFile = require('../src/models/StashFile');
const Note = require('../src/models/Note');
const Notebook = require('../src/models/Notebook');
const noteLinkService = require('../src/services/noteLinkService');
const stashCleanupService = require('../src/services/stashCleanupService');
const quickNoteController = require('../src/controllers/quickNoteController');
const stashController = require('../src/controllers/stashController');
const { extractHttpLinks, fixEncoding } = require('../src/utils/stashHelpers');
const { computeNoteContentHash } = require('../src/utils/noteHash');

const tempUploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-notes-quickmemo-test-'));
fs.mkdirSync(path.join(tempUploadRoot, 'stash'), { recursive: true });
fs.mkdirSync(path.join(tempUploadRoot, 'notes'), { recursive: true });

const origUploadsPath = config.uploads.path;
const origPublicBaseUrl = config.publicBaseUrl;
const origPermanentQuota = config.quickNotes.permanentQuotaBytes;
config.uploads.path = tempUploadRoot;
config.publicBaseUrl = 'https://notes.example.com';

const invokeHandler = (handler, req) => new Promise((resolve) => {
    const res = {
        statusCode: 0,
        headers: {},
        body: null,
        setHeader(k, v) {
            this.headers[k.toLowerCase()] = v;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            resolve({ res: this, err: null });
            return this;
        }
    };
    handler(req, res, (err) => resolve({ res, err }));
});

const invokeStreamHandler = (handler, req) => new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.headers = {};
    stream.headersSent = false;
    stream.setHeader = (k, v) => {
        stream.headers[k.toLowerCase()] = v;
    };
    stream.status = (code) => {
        stream.statusCode = code;
        return stream;
    };
    stream.json = (data) => {
        stream.body = data;
        resolve({ res: stream, buffer: null, err: null });
        return stream;
    };
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => {
        resolve({ res: stream, buffer: Buffer.concat(chunks), err: null });
    });
    stream.on('error', reject);
    handler(req, stream, (err) => resolve({ res: stream, buffer: null, err }));
});

const leanQuery = rows => ({
    sort() { return this; },
    limit() { return this; },
    select() { return this; },
    lean: async () => rows,
    then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected)
});

const originals = {
    qmFind: QuickMemo.find,
    qmFindOne: QuickMemo.findOne,
    qmFindOneAndUpdate: QuickMemo.findOneAndUpdate,
    qmCreate: QuickMemo.create,
    qmUpdateOne: QuickMemo.updateOne,
    qmUpdateMany: QuickMemo.updateMany,
    qmDeleteMany: QuickMemo.deleteMany,
    sfFind: StashFile.find,
    sfFindOne: StashFile.findOne,
    sfFindOneAndUpdate: StashFile.findOneAndUpdate,
    sfDeleteOne: StashFile.deleteOne,
    sfDeleteMany: StashFile.deleteMany,
    noteCreate: Note.create,
    noteFindOne: Note.findOne,
    nbFindOne: Notebook.findOne,
    syncNoteLinks: noteLinkService.syncNoteLinks,
    resolveBacklinks: noteLinkService.resolveUnresolvedBacklinksOnTitleChange
};

afterEach(() => {
    QuickMemo.find = originals.qmFind;
    QuickMemo.findOne = originals.qmFindOne;
    QuickMemo.findOneAndUpdate = originals.qmFindOneAndUpdate;
    QuickMemo.create = originals.qmCreate;
    QuickMemo.updateOne = originals.qmUpdateOne;
    QuickMemo.updateMany = originals.qmUpdateMany;
    QuickMemo.deleteMany = originals.qmDeleteMany;
    StashFile.find = originals.sfFind;
    StashFile.findOne = originals.sfFindOne;
    StashFile.findOneAndUpdate = originals.sfFindOneAndUpdate;
    StashFile.deleteOne = originals.sfDeleteOne;
    StashFile.deleteMany = originals.sfDeleteMany;
    Note.create = originals.noteCreate;
    Note.findOne = originals.noteFindOne;
    Notebook.findOne = originals.nbFindOne;
    noteLinkService.syncNoteLinks = originals.syncNoteLinks;
    noteLinkService.resolveUnresolvedBacklinksOnTitleChange = originals.resolveBacklinks;
    config.quickNotes.permanentQuotaBytes = origPermanentQuota;
});

after(() => {
    config.uploads.path = origUploadsPath;
    config.publicBaseUrl = origPublicBaseUrl;
    fs.rmSync(tempUploadRoot, { recursive: true, force: true });
});

describe('QuickMemo 与 Stash 底座单元测试', () => {
    it('StashFile 模型不应再包含 expireAfterSeconds TTL 索引，防止与磁盘清理竞态', () => {
        const indexes = StashFile.schema.indexes();
        const hasTtlIndex = indexes.some(([, opts]) => opts && Object.prototype.hasOwnProperty.call(opts, 'expireAfterSeconds'));
        assert.equal(hasTtlIndex, false);
        const memoIndexes = QuickMemo.schema.indexes();
        const memoHasTtl = memoIndexes.some(([, opts]) => opts && Object.prototype.hasOwnProperty.call(opts, 'expireAfterSeconds'));
        assert.equal(memoHasTtl, false);
    });

    it('extractHttpLinks 仅提取合法 http/https 链接，过滤 javascript:/data: 等危险协议', () => {
        const links = extractHttpLinks('看这里 https://notes.example.com/a?x=1，还有 javascript:alert(1) 和 data:text/html,hi 以及 http://127.0.0.1:3001/test。');
        assert.deepEqual(links, [
            { url: 'https://notes.example.com/a?x=1', host: 'notes.example.com' },
            { url: 'http://127.0.0.1:3001/test', host: '127.0.0.1:3001' }
        ]);
    });

    it('createTextMemo 支持链接识别、20 分钟默认 TTL、50KB 校验与 clientId 幂等', async () => {
        const userId = new mongoose.Types.ObjectId();
        let createdPayload = null;

        QuickMemo.findOne = async () => null;
        QuickMemo.create = async (payload) => {
            createdPayload = payload;
            return {
                _id: new mongoose.Types.ObjectId(),
                ...payload,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        };

        const beforeMs = Date.now();
        const { res, err } = await invokeHandler(quickNoteController.createTextMemo, {
            user: { _id: userId },
            body: {
                content: '参考文档 https://docs.example.com/guide',
                clientId: 'client-text-1'
            }
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.data.kind, 'link');
        assert.equal(res.body.data.storageType, 'temp');
        assert.deepEqual(res.body.data.links, [{ url: 'https://docs.example.com/guide', host: 'docs.example.com' }]);
        const ttlDiff = new Date(createdPayload.expireAt).getTime() - beforeMs;
        assert.ok(ttlDiff >= 19 * 60 * 1000 && ttlDiff <= 21 * 60 * 1000);

        // 幂等重放命中已有记录
        QuickMemo.findOne = async () => ({
            _id: new mongoose.Types.ObjectId(),
            userId,
            kind: 'link',
            content: '参考文档 https://docs.example.com/guide',
            links: [{ url: 'https://docs.example.com/guide', host: 'docs.example.com' }],
            storageType: 'temp',
            expireAt: createdPayload.expireAt,
            createdAt: new Date(),
            updatedAt: new Date()
        });
        let createCalledOnReplay = false;
        QuickMemo.create = async () => { createCalledOnReplay = true; };

        const replay = await invokeHandler(quickNoteController.createTextMemo, {
            user: { _id: userId },
            body: {
                content: '参考文档 https://docs.example.com/guide',
                clientId: 'client-text-1'
            }
        });
        assert.equal(replay.err, null);
        assert.equal(replay.res.statusCode, 200);
        assert.equal(createCalledOnReplay, false);

        // 超过 50KB 文本必须拦截
        const tooLong = 'a'.repeat(50 * 1024 + 1);
        const oversized = await invokeHandler(quickNoteController.createTextMemo, {
            user: { _id: userId },
            body: { content: tooLong }
        });
        assert.ok(oversized.err);
        assert.equal(oversized.err.statusCode, 400);
    });

    it('uploadFileMemo 在永久配额超限时应拦截 413 并删除已落盘文件避免孤儿泄漏', async () => {
        const userId = new mongoose.Types.ObjectId();
        config.quickNotes.permanentQuotaBytes = 1000;

        const diskFile = path.join(tempUploadRoot, 'stash', 'quota-test.bin');
        fs.writeFileSync(diskFile, Buffer.alloc(600));

        QuickMemo.find = () => leanQuery([{ storageType: 'permanent', attachment: { size: 700 }, content: '' }]);
        StashFile.find = () => leanQuery([]);

        const { err } = await invokeHandler(quickNoteController.uploadFileMemo, {
            user: { _id: userId },
            body: { storageType: 'permanent' },
            file: {
                filename: 'quota-test.bin',
                path: diskFile,
                originalname: 'quota-test.bin',
                size: 600,
                mimetype: 'application/octet-stream'
            }
        });

        assert.ok(err);
        assert.equal(err.statusCode, 413);
        assert.equal(fs.existsSync(diskFile), false);
    });

    it('promoteMemo 与 extendMemo 支持临时转永久、续期 +20m 与存量 StashFile 兼容', async () => {
        const userId = new mongoose.Types.ObjectId();
        const memoId = new mongoose.Types.ObjectId();
        const legacyId = new mongoose.Types.ObjectId();
        const futureExpire = new Date(Date.now() + 5 * 60 * 1000);

        // 续期 +20m
        QuickMemo.findOne = async () => ({
            _id: memoId,
            userId,
            kind: 'text',
            content: '待续期',
            storageType: 'temp',
            expireAt: futureExpire,
            isDeleted: false
        });
        QuickMemo.findOneAndUpdate = async (_filter, update) => ({
            _id: memoId,
            userId,
            kind: 'text',
            content: '待续期',
            storageType: 'temp',
            expireAt: update.$set.expireAt,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const extendRes = await invokeHandler(quickNoteController.extendMemo, {
            user: { _id: userId },
            params: { id: memoId.toString() },
            body: {}
        });
        assert.equal(extendRes.err, null);
        assert.equal(extendRes.res.statusCode, 200);
        const extendedDiff = new Date(extendRes.res.body.data.expireAt).getTime() - futureExpire.getTime();
        assert.equal(extendedDiff, 20 * 60 * 1000);

        // 存量 StashFile 转永久
        QuickMemo.findOne = async () => null;
        QuickMemo.find = () => leanQuery([]);
        StashFile.find = () => leanQuery([]);
        StashFile.findOne = async () => ({
            _id: legacyId,
            userId,
            filename: 'old.png',
            originalName: 'old.png',
            size: 120,
            mimetype: 'image/png',
            storageType: 'temp',
            expireAt: futureExpire,
            url: 'https://notes.example.com/uploads/stash/old.png'
        });
        StashFile.findOneAndUpdate = async () => ({
            _id: legacyId,
            userId,
            filename: 'old.png',
            originalName: 'old.png',
            size: 120,
            mimetype: 'image/png',
            storageType: 'permanent',
            expireAt: null,
            url: 'https://notes.example.com/uploads/stash/old.png',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const promoteLegacy = await invokeHandler(quickNoteController.promoteMemo, {
            user: { _id: userId },
            params: { id: legacyId.toString() }
        });
        assert.equal(promoteLegacy.err, null);
        assert.equal(promoteLegacy.res.statusCode, 200);
        assert.equal(promoteLegacy.res.body.data.storageType, 'permanent');
        assert.equal(promoteLegacy.res.body.data.legacySource, 'stash');
        assert.equal(promoteLegacy.res.body.data.expireAt, null);
    });

    it('listQuickNotes 与 deltaQuickNotes 正确合流升序、返回统计配额与软删除墓碑', async () => {
        const userId = new mongoose.Types.ObjectId();
        const t1 = new Date('2026-11-20T10:00:00Z');
        const t2 = new Date('2026-11-20T10:01:00Z');
        const id1 = new mongoose.Types.ObjectId();
        const id2 = new mongoose.Types.ObjectId();

        QuickMemo.find = () => leanQuery([]);
        QuickMemo.updateMany = async () => ({ modifiedCount: 0 });
        QuickMemo.deleteMany = async () => ({ deletedCount: 0 });
        StashFile.find = () => leanQuery([]);
        StashFile.deleteMany = async () => ({ deletedCount: 0 });

        // listQuickNotes 数据桩
        const activeMemo = {
            _id: id2,
            userId,
            kind: 'text',
            content: '新随心记',
            links: [],
            attachment: null,
            storageType: 'permanent',
            expireAt: null,
            isDeleted: false,
            createdAt: t2,
            updatedAt: t2
        };
        const activeStash = {
            _id: id1,
            userId,
            filename: 'legacy.pdf',
            originalName: 'legacy.pdf',
            relativePath: '',
            folderName: '',
            size: 500,
            mimetype: 'application/pdf',
            storageType: 'temp',
            expireAt: new Date(Date.now() + 60000),
            url: 'https://notes.example.com/uploads/stash/legacy.pdf',
            createdAt: t1,
            updatedAt: t1
        };

        QuickMemo.find = (q) => {
            if (q && q.isDeleted === true) return leanQuery([]);
            if (q && q.expireAt && q.expireAt.$lte) return leanQuery([]);
            return leanQuery([activeMemo]);
        };
        StashFile.find = (q) => {
            if (q && q.expireAt && q.expireAt.$lte) return leanQuery([]);
            return leanQuery([activeStash]);
        };

        const listRes = await invokeHandler(quickNoteController.listQuickNotes, {
            user: { _id: userId },
            query: {}
        });
        assert.equal(listRes.err, null);
        assert.equal(listRes.res.statusCode, 200);
        assert.equal(listRes.res.body.data.items.length, 2);
        assert.equal(listRes.res.body.data.items[0].legacySource, 'stash');
        assert.equal(listRes.res.body.data.items[1].content, '新随心记');
        assert.deepEqual(listRes.res.body.data.counts, { all: 2, temp: 1, permanent: 1 });
        assert.equal(listRes.res.body.data.quota.permanentUsedBytes, Buffer.byteLength('新随心记', 'utf8'));

        // deltaQuickNotes 返回墓碑
        const deletedId = new mongoose.Types.ObjectId();
        QuickMemo.find = (q) => {
            if (q && q.isDeleted === true) return leanQuery([]);
            if (q && q.expireAt && q.expireAt.$lte) return leanQuery([]);
            if (q && q.isDeleted === false) return leanQuery([activeMemo]);
            return leanQuery([{ ...activeMemo, _id: deletedId, isDeleted: true, deletedAt: new Date() }]);
        };

        const deltaRes = await invokeHandler(quickNoteController.deltaQuickNotes, {
            user: { _id: userId },
            query: { since: t1.toISOString() }
        });
        assert.equal(deltaRes.err, null);
        assert.equal(deltaRes.res.statusCode, 200);
        assert.equal(deltaRes.res.body.data.items.length, 1);
        assert.equal(deltaRes.res.body.data.items[0].isDeleted, true);
        assert.equal(deltaRes.res.body.data.legacyItems.length, 1);
    });

    it('cleanupExpiredFiles 与 deleteMemo 应先物理删除磁盘文件再删库/标墓碑', async () => {
        const userId = new mongoose.Types.ObjectId();
        const expiredStashPath = path.join(tempUploadRoot, 'stash', 'expired-old.txt');
        const expiredMemoPath = path.join(tempUploadRoot, 'stash', 'expired-memo.png');
        fs.writeFileSync(expiredStashPath, 'old');
        fs.writeFileSync(expiredMemoPath, 'memo-img');

        const expiredStashId = new mongoose.Types.ObjectId();
        const expiredMemoId = new mongoose.Types.ObjectId();
        let deletedStashIds = [];
        let tombstonedMemoIds = [];

        StashFile.find = () => leanQuery([{ _id: expiredStashId, filename: 'expired-old.txt', storageType: 'temp' }]);
        StashFile.deleteMany = async (filter) => {
            deletedStashIds = filter._id.$in;
        };
        QuickMemo.find = (q) => {
            if (q && q.isDeleted === false) {
                return leanQuery([{ _id: expiredMemoId, attachment: { filename: 'expired-memo.png' }, storageType: 'temp' }]);
            }
            return leanQuery([]);
        };
        QuickMemo.updateMany = async (filter) => {
            tombstonedMemoIds = filter._id.$in;
        };
        QuickMemo.deleteMany = async () => {};

        const cleaned = await stashCleanupService.cleanupExpiredFiles();
        assert.equal(cleaned, 2);
        assert.equal(fs.existsSync(expiredStashPath), false);
        assert.equal(fs.existsSync(expiredMemoPath), false);
        assert.deepEqual(deletedStashIds, [expiredStashId]);
        assert.deepEqual(tombstonedMemoIds, [expiredMemoId]);

        // 手动 deleteMemo 软删与物理删除
        const manualFile = path.join(tempUploadRoot, 'stash', 'manual-del.txt');
        fs.writeFileSync(manualFile, 'manual');
        const manualId = new mongoose.Types.ObjectId();
        let softDeletedFilter = null;

        QuickMemo.findOne = async () => ({
            _id: manualId,
            userId,
            attachment: { filename: 'manual-del.txt' },
            isDeleted: false
        });
        QuickMemo.updateOne = async (filter) => {
            softDeletedFilter = filter;
        };

        const delRes = await invokeHandler(quickNoteController.deleteMemo, {
            user: { _id: userId },
            params: { id: manualId.toString() }
        });
        assert.equal(delRes.err, null);
        assert.equal(delRes.res.statusCode, 200);
        assert.equal(fs.existsSync(manualFile), false);
        assert.equal(softDeletedFilter._id, manualId.toString());
    });

    it('convertToNote 应将临时图片物理拷贝至 uploads/notes/、保留原随心记并写入 convertedNoteId', async () => {
        const userId = new mongoose.Types.ObjectId();
        const memoId = new mongoose.Types.ObjectId();
        const notebookId = new mongoose.Types.ObjectId();
        const noteId = new mongoose.Types.ObjectId();

        const stashFilename = 'temp-photo.png';
        const srcFile = path.join(tempUploadRoot, 'stash', stashFilename);
        fs.writeFileSync(srcFile, 'fake-png-bytes');

        const memoDoc = {
            _id: memoId,
            userId,
            kind: 'image',
            content: '随手拍的图',
            links: [],
            attachment: {
                filename: stashFilename,
                originalName: '截图.png',
                relativePath: '',
                folderName: '',
                size: 14,
                mimetype: 'image/png',
                url: `https://notes.example.com/uploads/stash/${stashFilename}`
            },
            storageType: 'temp',
            expireAt: new Date(Date.now() + 20 * 60 * 1000),
            convertedNoteId: null,
            isDeleted: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        QuickMemo.findOne = async () => memoDoc;
        Notebook.findOne = async () => ({ _id: notebookId, userId, name: '默认笔记本', isDefault: true, isEncrypted: false });
        Note.create = async (payload) => ({ _id: noteId, ...payload });
        Note.findOne = async () => null;
        noteLinkService.syncNoteLinks = async () => ({ outlinks: [], unresolvedLinks: [] });
        noteLinkService.resolveUnresolvedBacklinksOnTitleChange = async () => {};
        QuickMemo.findOneAndUpdate = async (_f, update) => ({
            ...memoDoc,
            convertedNoteId: update.$set.convertedNoteId
        });

        const { res, err } = await invokeHandler(quickNoteController.convertToNote, {
            user: { _id: userId },
            params: { id: memoId.toString() },
            body: { title: '转存图片笔记' },
            protocol: 'https',
            get: () => 'notes.example.com'
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        const createdNote = res.body.data.note;
        assert.equal(createdNote.title, '转存图片笔记');
        assert.equal(createdNote.contentVersion, 1);
        assert.equal(
            createdNote.contentHash,
            computeNoteContentHash({ title: createdNote.title, content: createdNote.content })
        );
        assert.match(createdNote.content, /!\[截图\.png\]\(https:\/\/notes\.example\.com\/uploads\/notes\/\d+-\d+\.png\)/);
        assert.match(createdNote.content, /随手拍的图/);

        // 验证物理文件已独立拷贝到 uploads/notes/ 且原 stash 文件未被删除
        const urlMatch = createdNote.content.match(/\/uploads\/notes\/([^\)\s]+)/);
        assert.ok(urlMatch);
        const copiedNoteFile = path.join(tempUploadRoot, 'notes', urlMatch[1]);
        assert.equal(fs.existsSync(copiedNoteFile), true);
        assert.equal(fs.readFileSync(copiedNoteFile, 'utf8'), 'fake-png-bytes');
        assert.equal(fs.existsSync(srcFile), true);
        assert.equal(res.body.data.memo.convertedNoteId, noteId.toString());
    });

    it('stashController.downloadFolder 与 quickNoteController.downloadFolder 使用 ZipArchive 正常流式输出 ZIP', async () => {
        const userId = new mongoose.Types.ObjectId();
        const fileName = 'zip-sample.txt';
        fs.writeFileSync(path.join(tempUploadRoot, 'stash', fileName), 'hello zip archive');

        // 1. 验证旧 stashController.downloadFolder 修复 archiver@8 ZipArchive 报错
        StashFile.find = () => leanQuery([{
            _id: new mongoose.Types.ObjectId(),
            filename: fileName,
            originalName: 'demo.txt',
            relativePath: 'docs/demo.txt',
            folderName: 'docs'
        }]);

        const legacyZip = await invokeStreamHandler(stashController.downloadFolder, {
            user: { _id: userId },
            query: { folderName: 'docs' }
        });
        assert.equal(legacyZip.err, null);
        assert.equal(legacyZip.res.headers['content-type'], 'application/zip');
        assert.equal(legacyZip.buffer.subarray(0, 2).toString('utf8'), 'PK');

        // 2. 验证 quickNoteController.downloadFolder 支持合并导出 QuickMemo + StashFile
        QuickMemo.find = () => leanQuery([{
            _id: new mongoose.Types.ObjectId(),
            attachment: {
                filename: fileName,
                originalName: 'memo-demo.txt',
                relativePath: 'docs/memo-demo.txt',
                folderName: 'docs'
            }
        }]);
        StashFile.find = () => leanQuery([]);

        const quickZip = await invokeStreamHandler(quickNoteController.downloadFolder, {
            user: { _id: userId },
            query: { folderName: 'docs' }
        });
        assert.equal(quickZip.err, null);
        assert.equal(quickZip.res.headers['content-type'], 'application/zip');
        assert.equal(quickZip.buffer.subarray(0, 2).toString('utf8'), 'PK');
    });

    it('fixEncoding 应无损保留合法 UTF-8 中文并准确纠偏 Latin-1 乱码', () => {
        const utf8Name = '截屏2026-11-21.png';
        const mojibake = Buffer.from(utf8Name, 'utf8').toString('latin1');

        assert.equal(fixEncoding(utf8Name), utf8Name);
        assert.equal(fixEncoding(mojibake), utf8Name);
        assert.equal(fixEncoding('readme-v1.txt'), 'readme-v1.txt');
        assert.equal(fixEncoding('café.txt'), 'café.txt');
    });

    it('uploadFileMemo 与 extendMemo 应对 batchExpireAt/续期执行 7 天上限钳制并过滤 relativePath 的 . 与 .. 片段', async () => {
        const userId = new mongoose.Types.ObjectId();
        const maxTtlMs = 7 * 24 * 60 * 60 * 1000;
        const diskFile = path.join(tempUploadRoot, 'stash', 'clamp-test.png');
        fs.writeFileSync(diskFile, 'clamp-bytes');

        let createdUploadPayload = null;
        QuickMemo.findOne = async () => null;
        QuickMemo.create = async (payload) => {
            createdUploadPayload = payload;
            return {
                _id: new mongoose.Types.ObjectId(),
                ...payload,
                createdAt: new Date(),
                updatedAt: new Date()
            };
        };

        const hugeFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        const beforeUploadMs = Date.now();
        const uploadRes = await invokeHandler(quickNoteController.uploadFileMemo, {
            user: { _id: userId },
            body: {
                storageType: 'temp',
                batchExpireAt: hugeFuture,
                relativePath: './../目录A/../子文件.png'
            },
            file: {
                filename: 'clamp-test.png',
                path: diskFile,
                originalname: '截屏2026-11-21.png',
                size: 11,
                mimetype: 'image/png'
            },
            protocol: 'https',
            get: () => 'notes.example.com'
        });

        assert.equal(uploadRes.err, null);
        assert.equal(uploadRes.res.statusCode, 201);
        assert.equal(createdUploadPayload.attachment.originalName, '截屏2026-11-21.png');
        assert.equal(createdUploadPayload.attachment.relativePath, '目录A/子文件.png');
        assert.equal(createdUploadPayload.attachment.folderName, '目录A');
        const uploadExpireDiff = new Date(createdUploadPayload.expireAt).getTime() - beforeUploadMs;
        assert.ok(uploadExpireDiff <= maxTtlMs + 5000 && uploadExpireDiff >= maxTtlMs - 5000);

        // extendMemo 超过 7 天上限时应被钳制到 now + 7 天内
        const memoId = new mongoose.Types.ObjectId();
        const nearCapExpire = new Date(Date.now() + maxTtlMs - 5 * 60 * 1000);
        QuickMemo.findOne = async () => ({
            _id: memoId,
            userId,
            kind: 'text',
            content: '临近7天上限',
            storageType: 'temp',
            expireAt: nearCapExpire,
            isDeleted: false
        });
        QuickMemo.findOneAndUpdate = async (_f, update) => ({
            _id: memoId,
            userId,
            kind: 'text',
            content: '临近7天上限',
            storageType: 'temp',
            expireAt: update.$set.expireAt,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const beforeExtendMs = Date.now();
        const extendRes = await invokeHandler(quickNoteController.extendMemo, {
            user: { _id: userId },
            params: { id: memoId.toString() },
            body: { ttlMinutes: 60 }
        });
        assert.equal(extendRes.err, null);
        assert.equal(extendRes.res.statusCode, 200);
        const extendedDiff = new Date(extendRes.res.body.data.expireAt).getTime() - beforeExtendMs;
        assert.ok(extendedDiff <= maxTtlMs + 5000);
    });
});
