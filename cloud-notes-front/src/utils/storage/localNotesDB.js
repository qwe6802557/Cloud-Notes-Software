/**
 * localNotesDB.js - 原生零依赖 IndexedDB 本地持久化访问层 (DAO)
 * 遵循 Andrej Karpathy 零兜底极简原则，基于原生 window.indexedDB 构建
 */

const DB_NAME = 'cloud_notes_local_db';
const DB_VERSION = 3;
const STORE_NOTES_CACHE = 'notes_cache';
const STORE_MUTATIONS = 'offline_mutations';
const STORE_SEARCH_INDEX = 'search_index';
const STORE_CONFLICTS = 'sync_conflicts';

let dbInstance = null;
let dbPromise = null;

/**
 * 打开或初始化本地数据库
 * @returns {Promise<IDBDatabase>}
 */
export function openLocalDB() {
    if (dbInstance) {
        return Promise.resolve(dbInstance);
    }
    if (dbPromise) {
        return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
            return reject(new Error('IndexedDB is not supported in this environment'));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = event => {
            const db = event.target.result;

            // 1. 本地笔记快照缓存表
            if (!db.objectStoreNames.contains(STORE_NOTES_CACHE)) {
                const noteStore = db.createObjectStore(STORE_NOTES_CACHE, { keyPath: 'id' });
                noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // 2. 离线突变重放任务表 (自增主键 seq)
            if (!db.objectStoreNames.contains(STORE_MUTATIONS)) {
                const mutStore = db.createObjectStore(STORE_MUTATIONS, { keyPath: 'seq', autoIncrement: true });
                mutStore.createIndex('noteId', 'noteId', { unique: false });
                mutStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // 3. 全库离线检索轻量索引表
            if (!db.objectStoreNames.contains(STORE_SEARCH_INDEX)) {
                const searchStore = db.createObjectStore(STORE_SEARCH_INDEX, { keyPath: 'id' });
                searchStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // 4. 同步冲突持久化裁决表（防止刷新丢失未解决冲突）
            if (!db.objectStoreNames.contains(STORE_CONFLICTS)) {
                const conflictStore = db.createObjectStore(STORE_CONFLICTS, { keyPath: 'noteId' });
                conflictStore.createIndex('detectedAt', 'detectedAt', { unique: false });
            }
        };

        request.onsuccess = event => {
            dbInstance = event.target.result;
            dbInstance.onversionchange = () => {
                dbInstance.close();
                dbInstance = null;
                dbPromise = null;
            };
            dbInstance.onclose = () => {
                dbInstance = null;
                dbPromise = null;
            };
            resolve(dbInstance);
        };

        request.onerror = event => {
            dbPromise = null;
            reject(event.target.error || new Error('Failed to open IndexedDB'));
        };
    });

    return dbPromise;
}

/**
 * 通用事务执行器
 */
function withTransaction(storeName, mode, callback) {
    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);

            let result;
            try {
                result = callback(store);
            } catch (err) {
                return reject(err);
            }

            transaction.oncomplete = () => resolve(result);
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
        });
    });
}

// ==================== 1. 笔记本地快照 API ====================

/**
 * 获取本地缓存的笔记数据
 * @param {string} id 笔记 ID
 * @returns {Promise<object|null>}
 */
export function getNoteCache(id) {
    if (!id) return Promise.resolve(null);
    return withTransaction(STORE_NOTES_CACHE, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 保存/更新单篇笔记的本地快照（原子合并既有字段，避免局部更新丢弃加密态、contentVersion 与 remoteUpdatedAt）
 * @param {object} noteCache
 */
export function saveNoteCache(noteCache) {
    if (!noteCache || !noteCache.id) return Promise.resolve();

    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NOTES_CACHE], 'readwrite');
            const store = tx.objectStore(STORE_NOTES_CACHE);
            const getReq = store.get(noteCache.id);

            getReq.onsuccess = () => {
                const existing = getReq.result || {};
                const isEncrypted = noteCache.isEncrypted !== undefined
                    ? Boolean(noteCache.isEncrypted)
                    : Boolean(existing.isEncrypted);
                const nextContent = noteCache.content !== undefined
                    ? noteCache.content
                    : (existing.content !== undefined ? existing.content : '');

                const record = {
                    ...existing,
                    id: noteCache.id,
                    title: noteCache.title !== undefined ? noteCache.title : (existing.title || ''),
                    // 加密笔记绝不落盘明文 content
                    content: isEncrypted ? '' : nextContent,
                    isEncrypted,
                    encryptedData: noteCache.encryptedData !== undefined
                        ? noteCache.encryptedData
                        : (existing.encryptedData !== undefined ? existing.encryptedData : null),
                    contentVersion: noteCache.contentVersion !== undefined
                        ? noteCache.contentVersion
                        : existing.contentVersion,
                    remoteUpdatedAt: noteCache.remoteUpdatedAt !== undefined
                        ? noteCache.remoteUpdatedAt
                        : existing.remoteUpdatedAt,
                    clientId: noteCache.clientId !== undefined
                        ? noteCache.clientId
                        : existing.clientId,
                    notebookId: noteCache.notebookId !== undefined
                        ? noteCache.notebookId
                        : existing.notebookId,
                    parentId: noteCache.parentId !== undefined
                        ? noteCache.parentId
                        : existing.parentId,
                    noteType: noteCache.noteType !== undefined
                        ? noteCache.noteType
                        : existing.noteType,
                    updatedAt: noteCache.updatedAt || existing.updatedAt || new Date().toISOString(),
                    lastSavedContent: isEncrypted
                        ? ''
                        : (noteCache.lastSavedContent !== undefined
                            ? noteCache.lastSavedContent
                            : (existing.lastSavedContent !== undefined ? existing.lastSavedContent : nextContent)),
                    lastSyncedAt: noteCache.lastSyncedAt !== undefined
                        ? noteCache.lastSyncedAt
                        : (existing.lastSyncedAt || new Date().toISOString()),
                    isDirty: noteCache.isDirty !== undefined
                        ? Boolean(noteCache.isDirty)
                        : Boolean(existing.isDirty)
                };

                store.put(record);
                tx.oncomplete = () => resolve(record);
            };

            getReq.onerror = () => reject(getReq.error);
            tx.onerror = () => reject(tx.error);
        });
    });
}

/**
 * 删除本地笔记快照
 * @param {string} id
 */
export function deleteNoteCache(id) {
    if (!id) return Promise.resolve();
    return withTransaction(STORE_NOTES_CACHE, 'readwrite', store => {
        store.delete(id);
    });
}

// ==================== 2. 离线突变队列 (Offline Mutations) API ====================

const SUPPORTED_MUTATION_ACTIONS = new Set(['create', 'update', 'delete', 'move', 'star']);

/**
 * 将离线突变任务压入队列（严格基于自增主键 seq 单调递增）
 * 支持 'create' | 'update' | 'delete' | 'move' | 'star'
 * - 同一 noteId 合并策略：同动作去重时仅在保留严格有序的前提下合并（或替换旧同动作并分配新递增 seq）
 * @param {object} param0 { noteId, action, payload, baseUpdatedAt, expectedVersion, clientId }
 * @returns {Promise<number>} seq 序号
 */
export function enqueueMutation({
    noteId,
    action = 'update',
    payload = {},
    baseUpdatedAt = null,
    expectedVersion = null,
    clientId = null
}) {
    if (!noteId) return Promise.resolve(-1);
    const normalizedAction = SUPPORTED_MUTATION_ACTIONS.has(action) ? action : 'update';

    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_MUTATIONS], 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            const index = store.index('noteId');
            const req = index.getAll(noteId);

            req.onsuccess = () => {
                const existing = (req.result || []).sort((a, b) => a.seq - b.seq);
                const sameActionTask = existing.find(t => t.action === normalizedAction);

                // 如果是 create 且队列里已存在 create，仅刷新创建载荷以保持原始 seq 在更新之前
                if (normalizedAction === 'create' && sameActionTask) {
                    sameActionTask.payload = {
                        ...sameActionTask.payload,
                        ...payload
                    };
                    if (clientId && !sameActionTask.clientId) {
                        sameActionTask.clientId = clientId;
                    }
                    sameActionTask.timestamp = Date.now();
                    sameActionTask.retryCount = 0;
                    sameActionTask.status = 'pending';
                    store.put(sameActionTask);
                    tx.oncomplete = () => resolve(sameActionTask.seq);
                    return;
                }

                // 合并冗余同动作时删除旧任务再插入新任务，确保最新动作始终获得严格单调递增的新 seq（不与穿插的 move/star 倒序）
                let inheritedBaseUpdatedAt = baseUpdatedAt;
                let inheritedExpectedVersion = expectedVersion;
                let inheritedPayload = { ...payload };

                if (sameActionTask && (normalizedAction === 'update' || normalizedAction === 'move' || normalizedAction === 'star' || normalizedAction === 'delete')) {
                    if (normalizedAction === 'update') {
                        inheritedPayload = {
                            ...sameActionTask.payload,
                            ...payload
                        };
                    }
                    if (!inheritedBaseUpdatedAt && sameActionTask.baseUpdatedAt) {
                        inheritedBaseUpdatedAt = sameActionTask.baseUpdatedAt;
                    }
                    if (inheritedExpectedVersion == null && sameActionTask.expectedVersion != null) {
                        inheritedExpectedVersion = sameActionTask.expectedVersion;
                    }
                    store.delete(sameActionTask.seq);
                }

                // delete 若针对尚未上云的 local_ 笔记，直接清理队列内关联任务即可
                if (normalizedAction === 'delete' && String(noteId).startsWith('local_')) {
                    existing.forEach(t => store.delete(t.seq));
                    tx.oncomplete = () => resolve(-1);
                    return;
                }

                const newTask = {
                    noteId,
                    action: normalizedAction,
                    payload: inheritedPayload,
                    baseUpdatedAt: inheritedBaseUpdatedAt,
                    expectedVersion: inheritedExpectedVersion,
                    clientId: clientId || payload?.clientId || null,
                    timestamp: Date.now(),
                    retryCount: 0,
                    status: 'pending',
                    lastError: null
                };
                const addReq = store.add(newTask);
                addReq.onsuccess = () => {
                    tx.oncomplete = () => resolve(addReq.result);
                };
            };

            req.onerror = () => reject(req.error);
            tx.onerror = () => reject(tx.error);
        });
    });
}

/**
 * 更新排队突变任务元数据（如 retryCount、status、lastError）
 * @param {number} seq
 * @param {object} patch
 */
export function updateMutationTask(seq, patch = {}) {
    if (!seq) return Promise.resolve();
    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_MUTATIONS], 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            const req = store.get(seq);

            req.onsuccess = () => {
                const task = req.result;
                if (!task) {
                    tx.oncomplete = () => resolve(null);
                    return;
                }
                const updated = { ...task, ...patch };
                store.put(updated);
                tx.oncomplete = () => resolve(updated);
            };
            req.onerror = () => reject(req.error);
            tx.onerror = () => reject(tx.error);
        });
    });
}

/**
 * 当离线 local_ 临时笔记首次 create 成功后，把本地快照、剩余排队任务和检索文档中的 tempId 原子重映射为真实服务端 ID
 * @param {string} tempId
 * @param {string} realId
 * @param {object} [serverNotePatch]
 */
export function remapNoteIdInLocalDB(tempId, realId, serverNotePatch = {}) {
    if (!tempId || !realId || tempId === realId) return Promise.resolve();
    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_NOTES_CACHE, STORE_MUTATIONS, STORE_SEARCH_INDEX], 'readwrite');
            const notesStore = tx.objectStore(STORE_NOTES_CACHE);
            const mutStore = tx.objectStore(STORE_MUTATIONS);
            const searchStore = tx.objectStore(STORE_SEARCH_INDEX);

            // 1. 迁移 notes_cache
            const cacheReq = notesStore.get(tempId);
            cacheReq.onsuccess = () => {
                const oldCache = cacheReq.result;
                if (oldCache) {
                    notesStore.delete(tempId);
                    notesStore.put({
                        ...oldCache,
                        ...serverNotePatch,
                        id: realId
                    });
                }
            };

            // 2. 迁移后续排队中的突变任务
            const mutIdx = mutStore.index('noteId');
            const mutReq = mutIdx.getAll(tempId);
            mutReq.onsuccess = () => {
                const tasks = mutReq.result || [];
                tasks.forEach(t => {
                    t.noteId = realId;
                    if (serverNotePatch.contentVersion !== undefined && t.expectedVersion == null) {
                        t.expectedVersion = serverNotePatch.contentVersion;
                    }
                    mutStore.put(t);
                });
            };

            // 3. 迁移检索索引文档
            const searchReq = searchStore.get(tempId);
            searchReq.onsuccess = () => {
                const oldDoc = searchReq.result;
                if (oldDoc) {
                    searchStore.delete(tempId);
                    searchStore.put({ ...oldDoc, id: realId });
                }
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

/**
 * 从队列中移除已处理成功的突变任务
 * @param {number} seq
 */
export function dequeueMutation(seq) {
    if (!seq) return Promise.resolve();
    return withTransaction(STORE_MUTATIONS, 'readwrite', store => {
        store.delete(seq);
    });
}

/**
 * 获取所有排队中的待同步突变任务
 * @returns {Promise<Array>} 按 seq 正序排序
 */
export function getPendingMutations() {
    return withTransaction(STORE_MUTATIONS, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => a.seq - b.seq);
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 获取排队任务总数
 * @returns {Promise<number>}
 */
export function getPendingMutationCount() {
    return withTransaction(STORE_MUTATIONS, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 清除指定笔记的所有排队任务
 * @param {string} noteId
 */
export function clearMutationsForNote(noteId) {
    if (!noteId) return Promise.resolve();
    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_MUTATIONS], 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            const index = store.index('noteId');
            const req = index.getAllKeys(noteId);

            req.onsuccess = () => {
                const keys = req.result || [];
                keys.forEach(k => store.delete(k));
                tx.oncomplete = () => resolve(keys.length);
            };
            req.onerror = () => reject(req.error);
            tx.onerror = () => reject(tx.error);
        });
    });
}

// ==================== 3. 全库离线检索轻量索引 (Search Index) API ====================

/**
 * 获取所有本地持久化的检索文档
 * @returns {Promise<Array>}
 */
export function getAllSearchIndexDocs() {
    return withTransaction(STORE_SEARCH_INDEX, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 批量保存/覆盖离线检索文档
 * @param {Array<object>} docs
 * @returns {Promise<void>}
 */
export function saveSearchIndexDocs(docs = []) {
    if (!Array.isArray(docs) || docs.length === 0) return Promise.resolve();
    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_SEARCH_INDEX], 'readwrite');
            const store = tx.objectStore(STORE_SEARCH_INDEX);

            docs.forEach(doc => {
                if (doc && doc.id) {
                    store.put(doc);
                }
            });

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });
}

/**
 * 增量新增或更新单篇笔记的检索条目
 * @param {object} doc { id, title, snippet, notebookId, notebookName, notebookColor, updatedAt }
 * @returns {Promise<void>}
 */
export function upsertSearchIndexDoc(doc) {
    if (!doc || !doc.id) return Promise.resolve();
    return withTransaction(STORE_SEARCH_INDEX, 'readwrite', store => {
        store.put(doc);
    });
}

/**
 * 删除单篇笔记的检索条目
 * @param {string} id
 * @returns {Promise<void>}
 */
export function deleteSearchIndexDoc(id) {
    if (!id) return Promise.resolve();
    return withTransaction(STORE_SEARCH_INDEX, 'readwrite', store => {
        store.delete(id);
    });
}

// ==================== 4. 未解决同步冲突持久化 (Sync Conflicts) API ====================

/**
 * 持久化单篇笔记未解决的同步冲突记录
 * @param {object} conflictRecord { noteId, localDraft, serverNote, isEncrypted, expectedVersion, detectedAt, message }
 */
export function saveConflictRecord(conflictRecord) {
    if (!conflictRecord || !conflictRecord.noteId) return Promise.resolve();
    const record = {
        ...conflictRecord,
        detectedAt: conflictRecord.detectedAt || new Date().toISOString()
    };
    return withTransaction(STORE_CONFLICTS, 'readwrite', store => {
        store.put(record);
    });
}

/**
 * 获取单篇笔记的未解决冲突记录
 * @param {string} noteId
 */
export function getConflictRecord(noteId) {
    if (!noteId) return Promise.resolve(null);
    return withTransaction(STORE_CONFLICTS, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.get(noteId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 获取全部未解决冲突记录
 * @returns {Promise<Array<object>>}
 */
export function getAllConflictRecords() {
    return withTransaction(STORE_CONFLICTS, 'readonly', store => {
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }).then(res => res);
}

/**
 * 删除已裁决的冲突记录
 * @param {string} noteId
 */
export function deleteConflictRecord(noteId) {
    if (!noteId) return Promise.resolve();
    return withTransaction(STORE_CONFLICTS, 'readwrite', store => {
        store.delete(noteId);
    });
}

