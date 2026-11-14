import { updateNote, createNote } from '@/api/notes';
import * as localNotesDB from '../localNotesDB';
import { computeInMemoryContentDigest } from '@/utils/noteCryptoHelper';
import syncManager from '../syncManager';

jest.mock('@/api/notes', () => ({
    updateNote: jest.fn(),
    createNote: jest.fn(),
    getNoteDetail: jest.fn(),
    getNotebooks: jest.fn(),
    createNotebook: jest.fn(),
    deleteNote: jest.fn(),
    moveNoteNode: jest.fn(),
    updateNoteStarred: jest.fn()
}));

jest.mock('../localNotesDB', () => ({
    saveNoteCache: jest.fn().mockResolvedValue(undefined),
    deleteNoteCache: jest.fn().mockResolvedValue(undefined),
    enqueueMutation: jest.fn().mockResolvedValue(undefined),
    dequeueMutation: jest.fn().mockResolvedValue(undefined),
    getPendingMutations: jest.fn().mockResolvedValue([]),
    clearMutationsForNote: jest.fn().mockResolvedValue(undefined),
    updateMutationTask: jest.fn().mockResolvedValue(undefined),
    remapNoteIdInLocalDB: jest.fn().mockResolvedValue(undefined),
    saveConflictRecord: jest.fn().mockResolvedValue(undefined),
    getAllConflictRecords: jest.fn().mockResolvedValue([]),
    deleteConflictRecord: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../search/localSearchEngine', () => ({
    localSearchEngine: {
        upsertDocument: jest.fn(),
        removeDocument: jest.fn()
    }
}));

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 10));

describe('syncManager 自动保存与手动保存并发竞态控制', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // CRA 默认开启 resetMocks=true，每次测试前重新绑定本地 DB 桩函数返回值
        localNotesDB.saveNoteCache.mockResolvedValue(undefined);
        localNotesDB.deleteNoteCache.mockResolvedValue(undefined);
        localNotesDB.enqueueMutation.mockResolvedValue(undefined);
        localNotesDB.dequeueMutation.mockResolvedValue(undefined);
        localNotesDB.getPendingMutations.mockResolvedValue([]);
        localNotesDB.clearMutationsForNote.mockResolvedValue(undefined);
        localNotesDB.updateMutationTask.mockResolvedValue(undefined);
        localNotesDB.remapNoteIdInLocalDB.mockResolvedValue(undefined);
        localNotesDB.saveConflictRecord.mockResolvedValue(undefined);
        localNotesDB.getAllConflictRecords.mockResolvedValue([]);
        localNotesDB.deleteConflictRecord.mockResolvedValue(undefined);

        syncManager.isOnline = true;
        syncManager.inFlightSyncs.clear();
        syncManager.remappedIdsMap.clear();
        syncManager.conflictsMap.clear();
        syncManager.contentVersionMap.clear();
        syncManager.lastSavedContentMap.clear();
        syncManager.lastSavedTitleMap.clear();
        syncManager.lastSavedDigestMap.clear();
        syncManager.lastSavedNoteMap.clear();
        syncManager.lastKnownRemoteUpdatedAt.clear();
        for (const timer of syncManager.debounceTimers.values()) {
            clearTimeout(timer);
        }
        syncManager.debounceTimers.clear();
    });

    it('自动保存在途期间点击相同内容手动保存，应串行等待并幂等合并（仅 1 次 PUT、零 409）', async () => {
        syncManager.setLastKnownRemoteUpdatedAt('note-race-1', '2026-11-15T00:00:00Z', '初始正文', 1, '测试标题');

        const pendingPut = deferred();
        updateNote.mockImplementationOnce(() => pendingPut.promise);

        const autoPromise = syncManager.syncNote(
            'note-race-1',
            {
                title: '测试标题',
                content: '自动保存的新正文',
                expectedVersion: 1,
                isEncrypted: false
            },
            { auto: true, saveType: 'auto' }
        );

        await flushMicrotasks();
        expect(updateNote).toHaveBeenCalledTimes(1);

        // 自动保存尚未返回，用户携带过期 expectedVersion=1 点击手动保存相同内容
        const manualPromise = syncManager.syncNote(
            'note-race-1',
            {
                title: '测试标题',
                content: '自动保存的新正文',
                expectedVersion: 1,
                isEncrypted: false
            },
            { auto: false, saveType: 'manual' }
        );

        await flushMicrotasks();
        expect(updateNote).toHaveBeenCalledTimes(1);

        pendingPut.resolve({
            note: {
                _id: 'note-race-1',
                title: '测试标题',
                content: '自动保存的新正文',
                contentVersion: 2,
                updatedAt: '2026-11-15T00:00:02Z'
            }
        });

        const [autoRes, manualRes] = await Promise.all([autoPromise, manualPromise]);

        expect(updateNote).toHaveBeenCalledTimes(1);
        expect(autoRes.success).toBe(true);
        expect(autoRes.contentVersion).toBe(2);
        expect(manualRes.success).toBe(true);
        expect(manualRes.coalesced).toBe(true);
        expect(manualRes.conflict).toBeFalsy();
        expect(manualRes.contentVersion).toBe(2);
        expect(manualRes.note?.contentVersion).toBe(2);
        expect(syncManager.conflictsMap.size).toBe(0);
    });

    it('自动保存在途期间用户继续编辑并点击手动保存，必须串行等待并使用最新 v2（而非过期 v1）', async () => {
        syncManager.setLastKnownRemoteUpdatedAt('note-race-2', '2026-11-15T00:00:00Z', 'v1', 1, '标题');

        let serverVersion = 1;
        const firstGate = deferred();
        const requestOrder = [];

        updateNote.mockImplementation(async (id, body) => {
            requestOrder.push({ content: body.content, expectedVersion: body.expectedVersion });
            if (body.content === '第一段自动保存') {
                await firstGate.promise;
            }
            if (body.expectedVersion !== serverVersion) {
                const err = new Error('conflict');
                err.status = 409;
                throw err;
            }
            serverVersion += 1;
            return {
                note: {
                    _id: id,
                    title: body.title,
                    content: body.content,
                    contentVersion: serverVersion,
                    updatedAt: `2026-11-15T00:00:0${serverVersion}Z`
                }
            };
        });

        const autoPromise = syncManager.syncNote(
            'note-race-2',
            { title: '标题', content: '第一段自动保存', expectedVersion: 1 },
            { auto: true, saveType: 'auto' }
        );

        await flushMicrotasks();
        // 第二次手动保存传入刻意过时的 expectedVersion: 1，模拟 UI 闭包未及时刷新的极端竞态
        const manualPromise = syncManager.syncNote(
            'note-race-2',
            { title: '标题', content: '第一段自动保存\n用户追加第二段', expectedVersion: 1 },
            { auto: false, saveType: 'manual' }
        );

        await flushMicrotasks();
        expect(requestOrder).toHaveLength(1);

        firstGate.resolve();
        const [res1, res2] = await Promise.all([autoPromise, manualPromise]);

        expect(requestOrder).toEqual([
            { content: '第一段自动保存', expectedVersion: 1 },
            { content: '第一段自动保存\n用户追加第二段', expectedVersion: 2 }
        ]);
        expect(res1.success).toBe(true);
        expect(res1.contentVersion).toBe(2);
        expect(res2.success).toBe(true);
        expect(res2.conflict).toBeFalsy();
        expect(res2.contentVersion).toBe(3);
    });

    it('加密笔记因随机 IV 导致密文变化但明文摘要一致时，在途自动保存与手动保存仍可幂等合并', async () => {
        const digest = computeInMemoryContentDigest('绝密备忘录内容');
        syncManager.setLastKnownRemoteUpdatedAt('note-enc-1', '2026-11-15T00:00:00Z', 'old_cipher', 1, '私密标题', 'old_digest');

        const gate = deferred();
        updateNote.mockImplementationOnce(() => gate.promise);

        const autoPromise = syncManager.syncNote(
            'note-enc-1',
            {
                title: '私密标题',
                content: '',
                isEncrypted: true,
                encryptedData: 'cipher_random_iv_1',
                contentDigest: digest,
                expectedVersion: 1
            },
            { auto: true, saveType: 'auto' }
        );

        await flushMicrotasks();

        const manualPromise = syncManager.syncNote(
            'note-enc-1',
            {
                title: '私密标题',
                content: '',
                isEncrypted: true,
                encryptedData: 'cipher_random_iv_2',
                contentDigest: digest,
                expectedVersion: 1
            },
            { auto: false, saveType: 'manual' }
        );

        gate.resolve({
            note: {
                _id: 'note-enc-1',
                title: '私密标题',
                isEncrypted: true,
                encryptedData: 'cipher_random_iv_1',
                contentVersion: 2,
                updatedAt: '2026-11-15T00:00:05Z'
            }
        });

        const [autoRes, manualRes] = await Promise.all([autoPromise, manualPromise]);
        expect(updateNote).toHaveBeenCalledTimes(1);
        expect(autoRes.success).toBe(true);
        expect(manualRes.success).toBe(true);
        expect(manualRes.coalesced).toBe(true);
    });

    it('离线 local_ 笔记在途首次建档升级期间点击保存，不会重复 createNote 两篇笔记', async () => {
        const gate = deferred();
        createNote.mockImplementationOnce(() => gate.promise);

        const autoCreate = syncManager.syncNote(
            'local_temp_1',
            { title: '离线草稿', content: '同步正文', notebookId: 'nb1' },
            { auto: true, saveType: 'auto' }
        );

        await flushMicrotasks();

        const manualSave = syncManager.syncNote(
            'local_temp_1',
            { title: '离线草稿', content: '同步正文', notebookId: 'nb1' },
            { auto: false, saveType: 'manual' }
        );

        gate.resolve({
            note: {
                _id: 'real_mongo_id_99',
                title: '离线草稿',
                content: '同步正文',
                contentVersion: 1,
                updatedAt: '2026-11-15T00:00:06Z'
            }
        });

        const [res1, res2] = await Promise.all([autoCreate, manualSave]);
        expect(createNote).toHaveBeenCalledTimes(1);
        expect(updateNote).toHaveBeenCalledTimes(0);
        expect(res1.realId).toBe('real_mongo_id_99');
        expect(res2.success).toBe(true);
        expect(res2.coalesced).toBe(true);
        expect(res2.realId).toBe('real_mongo_id_99');
    });

    it('面对真实多端 409 冲突时仍严格挂起冲突状态，绝不静默覆盖远端', async () => {
        syncManager.setLastKnownRemoteUpdatedAt('note-conflict-1', '2026-11-15T00:00:00Z', 'v1', 1, '双端冲突');
        const err409 = new Error('Version conflict');
        err409.status = 409;
        err409.conflictData = {
            serverNote: {
                _id: 'note-conflict-1',
                title: '双端冲突',
                content: '另一台手机改过的新内容',
                contentVersion: 2
            }
        };
        updateNote.mockRejectedValueOnce(err409);

        const res = await syncManager.syncNote(
            'note-conflict-1',
            { title: '双端冲突', content: '本地不兼容改写', expectedVersion: 1 },
            { auto: false, saveType: 'manual' }
        );

        expect(res.success).toBe(false);
        expect(res.conflict).toBe(true);
        expect(syncManager.conflictsMap.has('note-conflict-1')).toBe(true);
        expect(syncManager.conflictsMap.get('note-conflict-1').serverVersion).toBe(2);
    });

    it('待触发的防抖自动保存定时器在手动保存调用时应被立即清除', async () => {
        jest.useFakeTimers();
        syncManager.setLastKnownRemoteUpdatedAt('note-timer-1', '2026-11-15T00:00:00Z', '旧文本', 1, '标题');
        updateNote.mockResolvedValue({
            note: {
                _id: 'note-timer-1',
                title: '标题',
                content: '手动提前保存的正文',
                contentVersion: 2,
                updatedAt: '2026-11-15T00:00:09Z'
            }
        });

        const onSyncSuccess = jest.fn();
        syncManager.scheduleAutoSync(
            'note-timer-1',
            { title: '标题', content: '待防抖正文', expectedVersion: 1, onSyncSuccess },
            1500
        );

        expect(syncManager.debounceTimers.has('note-timer-1')).toBe(true);

        const manualRes = await syncManager.syncNote(
            'note-timer-1',
            { title: '标题', content: '手动提前保存的正文', expectedVersion: 1 },
            { auto: false, saveType: 'manual' }
        );

        expect(syncManager.debounceTimers.has('note-timer-1')).toBe(false);
        expect(manualRes.success).toBe(true);

        jest.advanceTimersByTime(3000);
        await Promise.resolve();
        expect(updateNote).toHaveBeenCalledTimes(1);
        expect(onSyncSuccess).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});
