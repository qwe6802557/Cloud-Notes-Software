const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// 按模块作用域轻量挂载 TypeScript 编译器与移动端原生/存储桩对象，直测真实 mobileSyncManager.ts 源码
const stubs = {
    'react-native': {
        AppState: { addEventListener: () => ({ remove: () => {} }) }
    },
    '@react-native-async-storage/async-storage': {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined
    }
};

const apiState = {
    updateNoteImpl: async () => ({ code: 200, data: {} }),
    createNoteImpl: async () => ({ code: 201, data: {} }),
    getNoteDetailImpl: async () => ({ code: 200, data: {} }),
    getNotebooksImpl: async () => ({ code: 200, data: [{ _id: 'nb-default', title: '默认笔记本' }] }),
    updateCalls: [],
    createCalls: []
};

const dbState = {
    cacheMap: new Map(),
    idRemap: new Map(),
    pendingMutations: [],
    conflicts: []
};

const mobileRoot = path.resolve(__dirname, '..');
const syncManagerTsPath = path.join(mobileRoot, 'src', 'utils', 'storage', 'mobileSyncManager.ts');
const mobileNotesDbPath = path.join(mobileRoot, 'src', 'utils', 'storage', 'mobileNotesDB.ts');
const notesApiPath = path.join(mobileRoot, 'src', 'api', 'notesApi.ts');
const clientApiPath = path.join(mobileRoot, 'src', 'api', 'client.ts');
const searchEnginePath = path.join(mobileRoot, 'src', 'utils', 'search', 'mobileSearchEngine.ts');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'react-native' || request === '@react-native-async-storage/async-storage') {
        return request;
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
};

require.cache['react-native'] = { id: 'react-native', filename: 'react-native', loaded: true, exports: stubs['react-native'] };
require.cache['@react-native-async-storage/async-storage'] = {
    id: '@react-native-async-storage/async-storage',
    filename: '@react-native-async-storage/async-storage',
    loaded: true,
    exports: stubs['@react-native-async-storage/async-storage']
};

require.cache[notesApiPath] = {
    id: notesApiPath,
    filename: notesApiPath,
    loaded: true,
    exports: {
        updateNote: async (id, payload) => {
            apiState.updateCalls.push({ id, payload });
            return apiState.updateNoteImpl(id, payload);
        },
        createNote: async (payload) => {
            apiState.createCalls.push({ payload });
            return apiState.createNoteImpl(payload);
        },
        getNoteDetail: async (id) => apiState.getNoteDetailImpl(id),
        getNotebooks: async () => apiState.getNotebooksImpl(),
        createNotebook: async (d) => ({ code: 201, data: { _id: 'nb-conflict', ...d } }),
        deleteNote: async () => ({ code: 200 }),
        updateNoteStarred: async () => ({ code: 200 }),
        moveNote: async () => ({ code: 200 })
    }
};

require.cache[clientApiPath] = {
    id: clientApiPath,
    filename: clientApiPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: { get: async () => ({ data: {} }) },
        setOnNetworkStateChange: () => {}
    }
};

require.cache[mobileNotesDbPath] = {
    id: mobileNotesDbPath,
    filename: mobileNotesDbPath,
    loaded: true,
    exports: {
        resolveNoteId: async (id) => dbState.idRemap.get(id) || id,
        getNoteCache: async (id) => dbState.cacheMap.get(id) || null,
        saveNoteCache: async (note) => {
            const prev = dbState.cacheMap.get(note.id) || {};
            dbState.cacheMap.set(note.id, { ...prev, ...note });
        },
        deleteNoteCache: async (id) => { dbState.cacheMap.delete(id); },
        createOfflineNote: async (note) => note,
        remapLocalNoteId: async (tempId, realNote) => {
            dbState.idRemap.set(tempId, realNote.id);
            dbState.cacheMap.delete(tempId);
            dbState.cacheMap.set(realNote.id, { ...realNote, isDirty: false });
        },
        enqueueMutation: async (mut) => {
            dbState.pendingMutations.push({ seq: Date.now() + Math.random(), retryCount: 0, ...mut });
        },
        dequeueMutation: async (seq) => {
            dbState.pendingMutations = dbState.pendingMutations.filter(m => m.seq !== seq);
        },
        getPendingMutations: async () => [...dbState.pendingMutations],
        getPendingMutationCount: async () => dbState.pendingMutations.length,
        clearMutationsForNote: async (noteId) => {
            dbState.pendingMutations = dbState.pendingMutations.filter(m => m.noteId !== noteId);
        },
        incrementMutationRetry: async () => 1,
        getSavedConflicts: async () => [...dbState.conflicts],
        saveConflicts: async (items) => { dbState.conflicts = [...items]; }
    }
};

require.cache[searchEnginePath] = {
    id: searchEnginePath,
    filename: searchEnginePath,
    loaded: true,
    exports: {
        mobileSearchEngine: {
            upsertDocument: () => {},
            removeDocument: () => {}
        }
    }
};

require.extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            esModuleInterop: true
        },
        fileName: filename
    });
    return module._compile(result.outputText, filename);
};

const {
    default: mobileSyncManager,
    computeInMemoryContentDigest
} = require(syncManagerTsPath);

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const tick = (ms = 12) => new Promise(resolve => setTimeout(resolve, ms));

describe('MobileSyncManager 自动保存与手动保存并发竞态测试', () => {
    beforeEach(() => {
        apiState.updateCalls = [];
        apiState.createCalls = [];
        dbState.cacheMap.clear();
        dbState.idRemap.clear();
        dbState.pendingMutations = [];
        dbState.conflicts = [];

        mobileSyncManager.isOnline = true;
        mobileSyncManager.conflictsMap.clear();
        mobileSyncManager.inFlightSyncs.clear();
        mobileSyncManager.remappedIdsMap.clear();
        mobileSyncManager.lastKnownVersionMap.clear();
        mobileSyncManager.lastSavedContentMap.clear();
        mobileSyncManager.lastSavedTitleMap.clear();
        mobileSyncManager.lastSavedDigestMap.clear();
        mobileSyncManager.lastKnownRemoteUpdatedAt.clear();
        for (const t of mobileSyncManager.debounceTimers.values()) {
            clearTimeout(t);
        }
        mobileSyncManager.debounceTimers.clear();
    });

    it('自动保存请求尚未返回时点击手机端「保存」，同内容应幂等合并且绝不弹出冲突框', async () => {
        mobileSyncManager.setLastKnownRemoteUpdatedAt('m-note-1', '2026-11-15T00:00:00Z', 'old', 1, '手机端标题');
        const gate = deferred();
        apiState.updateNoteImpl = () => gate.promise;

        const syncedEvents = [];
        const unsub = mobileSyncManager.subscribeNoteSynced(ev => syncedEvents.push(ev));

        const autoPromise = mobileSyncManager.syncNote(
            'm-note-1',
            {
                title: '手机端标题',
                content: '在地铁里打的正文内容',
                expectedVersion: 1,
                isEncrypted: false
            },
            { auto: true }
        );

        await tick();
        assert.equal(apiState.updateCalls.length, 1);

        // 用户在自动保存仍在路上时点击手动「保存」（带着旧 baseVersion=1）
        const manualPromise = mobileSyncManager.syncNote(
            'm-note-1',
            {
                title: '手机端标题',
                content: '在地铁里打的正文内容',
                expectedVersion: 1,
                isEncrypted: false,
                saveType: 'manual'
            }
        );

        await tick();
        assert.equal(apiState.updateCalls.length, 1);

        gate.resolve({
            code: 200,
            data: {
                _id: 'm-note-1',
                title: '手机端标题',
                content: '在地铁里打的正文内容',
                contentVersion: 2,
                updatedAt: '2026-11-15T00:00:02Z'
            }
        });

        const [autoRes, manualRes] = await Promise.all([autoPromise, manualPromise]);
        unsub();

        assert.equal(apiState.updateCalls.length, 1);
        assert.equal(autoRes.success, true);
        assert.equal(autoRes.contentVersion, 2);
        assert.equal(manualRes.success, true);
        assert.equal(manualRes.coalesced, true);
        assert.equal(manualRes.conflict, undefined);
        assert.equal(manualRes.contentVersion, 2);
        assert.equal(syncedEvents.length, 2);
        assert.equal(syncedEvents[1].coalesced, true);
    });

    it('自动保存在途期间继续追加文字并点击保存，串行等待后必须使用最新 v2 推进到 v3', async () => {
        mobileSyncManager.setLastKnownRemoteUpdatedAt('m-note-2', '2026-11-15T00:00:00Z', '初始', 1, '标题');

        let serverVersion = 1;
        const gate = deferred();
        const sentVersions = [];

        apiState.updateNoteImpl = async (id, payload) => {
            sentVersions.push({ version: payload.expectedVersion, content: payload.content });
            if (payload.content === '段落A') {
                await gate.promise;
            }
            if (payload.expectedVersion !== serverVersion) {
                const err = new Error('Conflict');
                err.status = 409;
                err.data = { data: { serverNote: { contentVersion: serverVersion, content: '段落A' } } };
                throw err;
            }
            serverVersion += 1;
            return {
                code: 200,
                data: {
                    _id: id,
                    title: payload.title,
                    content: payload.content,
                    contentVersion: serverVersion,
                    updatedAt: `2026-11-15T00:00:0${serverVersion}Z`
                }
            };
        };

        const autoPromise = mobileSyncManager.syncNote(
            'm-note-2',
            { title: '标题', content: '段落A', expectedVersion: 1 },
            { auto: true }
        );

        await tick();

        // 模拟 edit.tsx 闭包中的 baseVersionRef 尚未更新仍传 1，且 title 存在首尾空格差异
        const manualPromise = mobileSyncManager.syncNote(
            'm-note-2',
            { title: ' 标题 ', content: '段落A\n段落B', expectedVersion: 1, saveType: 'manual' }
        );

        await tick();
        assert.equal(sentVersions.length, 1);

        gate.resolve();
        const [r1, r2] = await Promise.all([autoPromise, manualPromise]);

        assert.deepEqual(sentVersions, [
            { version: 1, content: '段落A' },
            { version: 2, content: '段落A\n段落B' }
        ]);
        assert.equal(r1.success, true);
        assert.equal(r1.contentVersion, 2);
        assert.equal(r2.success, true);
        assert.equal(r2.conflict, undefined);
        assert.equal(r2.contentVersion, 3);
    });

    it('加密笔记在途随机 IV 重加密后手动保存（相同明文摘要），跳过重复上传并零冲突收口', async () => {
        const digest = computeInMemoryContentDigest('手机端私密正文');
        mobileSyncManager.setLastKnownRemoteUpdatedAt('m-enc-1', '2026-11-15T00:00:00Z', 'old_enc', 1, '加密标题', 'old_digest');

        const gate = deferred();
        apiState.updateNoteImpl = () => gate.promise;

        const autoEnc = mobileSyncManager.syncNote(
            'm-enc-1',
            {
                title: '加密标题',
                content: '',
                isEncrypted: true,
                encryptedData: 'aes_iv_auto',
                contentDigest: digest,
                expectedVersion: 1
            },
            { auto: true }
        );

        await tick();

        const manualEnc = mobileSyncManager.syncNote(
            'm-enc-1',
            {
                title: '加密标题',
                content: '',
                isEncrypted: true,
                encryptedData: 'aes_iv_manual_different',
                contentDigest: digest,
                expectedVersion: 1,
                saveType: 'manual'
            }
        );

        gate.resolve({
            code: 200,
            data: {
                _id: 'm-enc-1',
                title: '加密标题',
                isEncrypted: true,
                encryptedData: 'aes_iv_auto',
                contentVersion: 2,
                updatedAt: '2026-11-15T00:00:04Z'
            }
        });

        const [res1, res2] = await Promise.all([autoEnc, manualEnc]);
        assert.equal(apiState.updateCalls.length, 1);
        assert.equal(res1.success, true);
        assert.equal(res2.success, true);
        assert.equal(res2.coalesced, true);
    });

    it('离线新建 local_ 笔记首次建档期间并发点击保存，仅建档 1 次并正确重映射 ID', async () => {
        const gate = deferred();
        apiState.createNoteImpl = () => gate.promise;

        const first = mobileSyncManager.syncNote(
            'local_m_1',
            { title: '离线随笔', content: '记录灵感', notebookId: 'nb1' },
            { auto: true }
        );

        await tick();

        const second = mobileSyncManager.syncNote(
            'local_m_1',
            { title: '离线随笔', content: '记录灵感', notebookId: 'nb1', saveType: 'manual' }
        );

        gate.resolve({
            code: 200,
            data: {
                _id: 'real_mobile_note_77',
                title: '离线随笔',
                content: '记录灵感',
                contentVersion: 1,
                updatedAt: '2026-11-15T00:00:05Z'
            }
        });

        const [r1, r2] = await Promise.all([first, second]);
        assert.equal(apiState.createCalls.length, 1);
        assert.equal(apiState.updateCalls.length, 0);
        assert.equal(r1.resolvedId, 'real_mobile_note_77');
        assert.equal(r2.success, true);
        assert.equal(r2.coalesced, true);
        assert.equal(r2.resolvedId, 'real_mobile_note_77');
    });

    it('真实多端外部更新造成 409 时仍应严格触发冲突态交由用户 Diff 裁决', async () => {
        mobileSyncManager.setLastKnownRemoteUpdatedAt('m-conflict-1', '2026-11-15T00:00:00Z', 'old', 1, '冲突测试');
        apiState.updateNoteImpl = async () => {
            const err = new Error('Version mismatch');
            err.status = 409;
            err.data = {
                data: {
                    serverNote: {
                        _id: 'm-conflict-1',
                        title: '冲突测试',
                        content: '电脑端先提交的不同内容',
                        contentVersion: 2,
                        updatedAt: '2026-11-15T00:00:08Z'
                    }
                }
            };
            throw err;
        };

        const res = await mobileSyncManager.syncNote(
            'm-conflict-1',
            { title: '冲突测试', content: '手机端不兼容修改', expectedVersion: 1, saveType: 'manual' }
        );

        assert.equal(res.success, false);
        assert.equal(res.conflict, true);
        assert.equal(mobileSyncManager.hasConflict('m-conflict-1'), true);
        assert.equal(mobileSyncManager.getConflict('m-conflict-1')?.serverNote?.contentVersion, 2);
    });
});
