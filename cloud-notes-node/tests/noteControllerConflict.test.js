const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');

mongoose.set('bufferCommands', false);

const Note = require('../src/models/Note');
const NoteHistory = require('../src/models/NoteHistory');
const noteLinkService = require('../src/services/noteLinkService');
const noteController = require('../src/controllers/noteController');

const hashNote = (title, content, isEncrypted = false, encryptedData = null) => {
    const body = isEncrypted ? (encryptedData || '') : (content || '');
    return crypto.createHash('sha256').update(`${title || ''}\n${body}`).digest('hex');
};

const invokeHandler = (handler, req) => new Promise((resolve) => {
    const res = {
        statusCode: 0,
        body: null,
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

const origNoteFindOne = Note.findOne;
const origNoteFindOneAndUpdate = Note.findOneAndUpdate;
const origHistoryFindOne = NoteHistory.findOne;
const origHistoryCreate = NoteHistory.create;
const origSyncLinks = noteLinkService.syncNoteLinks;

afterEach(() => {
    Note.findOne = origNoteFindOne;
    Note.findOneAndUpdate = origNoteFindOneAndUpdate;
    NoteHistory.findOne = origHistoryFindOne;
    NoteHistory.create = origHistoryCreate;
    noteLinkService.syncNoteLinks = origSyncLinks;
});

describe('noteController.updateNote 自动保存与手动保存幂等收敛及真实冲突防护', () => {
    it('自动保存已推进到 v2 后，携带过期 expectedVersion=1 且同内容的手动保存应幂等返回 200', async () => {
        const currentDoc = {
            _id: 'note-1',
            userId: 'user-1',
            type: 'note',
            isDeleted: false,
            title: '并发测试笔记',
            content: '已由自动保存落库的正文',
            isEncrypted: false,
            encryptedData: null,
            contentVersion: 2,
            contentHash: hashNote('并发测试笔记', '已由自动保存落库的正文'),
            tags: [],
            outlinks: [],
            updatedAt: new Date('2026-11-15T00:00:00Z'),
            $isDefault: () => false
        };

        let updateCalled = false;
        let syncLinksCalled = false;
        let historyCreated = false;

        Note.findOne = () => ({
            populate: async () => currentDoc,
            then: (onFulfilled, onRejected) => Promise.resolve(currentDoc).then(onFulfilled, onRejected)
        });
        Note.findOneAndUpdate = () => {
            updateCalled = true;
            return { populate: async () => currentDoc };
        };
        noteLinkService.syncNoteLinks = async () => {
            syncLinksCalled = true;
            return { outlinks: [], unresolvedLinks: [] };
        };
        NoteHistory.create = async () => {
            historyCreated = true;
        };

        const { res, err } = await invokeHandler(noteController.updateNote, {
            params: { id: 'note-1' },
            user: { _id: 'user-1' },
            body: {
                title: '并发测试笔记',
                content: '已由自动保存落库的正文',
                isEncrypted: false,
                saveType: 'manual',
                expectedVersion: 1
            }
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.idempotent, true);
        assert.equal(res.body.data.note.contentVersion, 2);
        assert.equal(updateCalled, false);
        assert.equal(syncLinksCalled, false);
        assert.equal(historyCreated, false);
    });

    it('另一设备已将云端改写为不同内容并推进到 v2 时，旧版本 expectedVersion=1 保存必须返回 409', async () => {
        const serverDoc = {
            _id: 'note-2',
            userId: 'user-1',
            type: 'note',
            isDeleted: false,
            title: '协同笔记',
            content: '另一端修改后的远端正文',
            isEncrypted: false,
            encryptedData: null,
            contentVersion: 2,
            contentHash: hashNote('协同笔记', '另一端修改后的远端正文'),
            tags: [],
            outlinks: [],
            updatedAt: new Date('2026-11-15T00:01:00Z'),
            $isDefault: () => false
        };

        let updateCalled = false;
        Note.findOne = async () => serverDoc;
        Note.findOneAndUpdate = () => {
            updateCalled = true;
            return { populate: async () => serverDoc };
        };

        const { res, err } = await invokeHandler(noteController.updateNote, {
            params: { id: 'note-2' },
            user: { _id: 'user-1' },
            body: {
                title: '协同笔记',
                content: '本端离线修改的冲突正文',
                isEncrypted: false,
                saveType: 'manual',
                expectedVersion: 1
            }
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.status, 'conflict');
        assert.equal(res.body.data.serverNote.contentVersion, 2);
        assert.equal(res.body.data.serverNote.content, '另一端修改后的远端正文');
        assert.equal(updateCalled, false);
    });

    it('原子 findOneAndUpdate 窗口期内并发请求先胜出时，同内容后发请求应幂等返回 200 而非误报 409', async () => {
        const v1Doc = {
            _id: 'note-3',
            userId: 'user-1',
            type: 'note',
            isDeleted: false,
            title: '并发竞争笔记',
            content: '初始内容',
            isEncrypted: false,
            encryptedData: null,
            contentVersion: 1,
            contentHash: hashNote('并发竞争笔记', '初始内容'),
            tags: [],
            outlinks: [],
            updatedAt: new Date('2026-11-15T00:00:00Z'),
            $isDefault: () => false
        };
        const v2Doc = {
            ...v1Doc,
            content: '双请求同一份新正文',
            contentVersion: 2,
            contentHash: hashNote('并发竞争笔记', '双请求同一份新正文'),
            updatedAt: new Date('2026-11-15T00:00:02Z')
        };

        let findCallCount = 0;
        Note.findOne = () => {
            findCallCount += 1;
            const doc = findCallCount === 1 ? v1Doc : v2Doc;
            return {
                populate: async () => doc,
                then: (onFulfilled, onRejected) => Promise.resolve(doc).then(onFulfilled, onRejected)
            };
        };
        Note.findOneAndUpdate = () => ({
            populate: async () => null
        });
        noteLinkService.syncNoteLinks = async () => ({ outlinks: [], unresolvedLinks: [] });

        const { res, err } = await invokeHandler(noteController.updateNote, {
            params: { id: 'note-3' },
            user: { _id: 'user-1' },
            body: {
                title: '并发竞争笔记',
                content: '双请求同一份新正文',
                isEncrypted: false,
                saveType: 'manual',
                expectedVersion: 1
            }
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.idempotent, true);
        assert.equal(res.body.data.note.contentVersion, 2);
    });

    it('原子 findOneAndUpdate 窗口期先胜出的内容与后发请求不一致时，必须返回 409', async () => {
        const v1Doc = {
            _id: 'note-4',
            userId: 'user-1',
            type: 'note',
            isDeleted: false,
            title: '竞态冲突笔记',
            content: '初始内容',
            isEncrypted: false,
            encryptedData: null,
            contentVersion: 1,
            contentHash: hashNote('竞态冲突笔记', '初始内容'),
            tags: [],
            outlinks: [],
            $isDefault: () => false
        };
        const v2Doc = {
            ...v1Doc,
            content: '胜出者写入的远端正文',
            contentVersion: 2,
            contentHash: hashNote('竞态冲突笔记', '胜出者写入的远端正文')
        };

        let findCallCount = 0;
        Note.findOne = async () => (++findCallCount === 1 ? v1Doc : v2Doc);
        Note.findOneAndUpdate = () => ({
            populate: async () => null
        });
        noteLinkService.syncNoteLinks = async () => ({ outlinks: [], unresolvedLinks: [] });

        const { res, err } = await invokeHandler(noteController.updateNote, {
            params: { id: 'note-4' },
            user: { _id: 'user-1' },
            body: {
                title: '竞态冲突笔记',
                content: '落败者的不同正文',
                isEncrypted: false,
                saveType: 'manual',
                expectedVersion: 1
            }
        });

        assert.equal(err, null);
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.status, 'conflict');
        assert.equal(res.body.data.serverNote.contentVersion, 2);
    });
});
