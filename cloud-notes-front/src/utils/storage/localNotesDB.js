/**
 * localNotesDB.js - 原生零依赖 IndexedDB 本地持久化访问层 (DAO)
 * 遵循 Andrej Karpathy 零兜底极简原则，基于原生 window.indexedDB 构建
 */

const DB_NAME = 'cloud_notes_local_db';
const DB_VERSION = 1;
const STORE_NOTES_CACHE = 'notes_cache';
const STORE_MUTATIONS = 'offline_mutations';

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
 * 保存/更新单篇笔记的本地快照
 * @param {object} noteCache
 */
export function saveNoteCache(noteCache) {
    if (!noteCache || !noteCache.id) return Promise.resolve();
    const record = {
        id: noteCache.id,
        title: noteCache.title || '',
        content: noteCache.content !== undefined ? noteCache.content : '',
        updatedAt: noteCache.updatedAt || new Date().toISOString(),
        lastSavedContent: noteCache.lastSavedContent !== undefined ? noteCache.lastSavedContent : noteCache.content || '',
        lastSyncedAt: noteCache.lastSyncedAt || new Date().toISOString(),
        isDirty: Boolean(noteCache.isDirty)
    };

    return withTransaction(STORE_NOTES_CACHE, 'readwrite', store => {
        store.put(record);
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

/**
 * 将离线突变任务压入队列（若相同 noteId 存在 update 任务，智能合并为最新状态）
 * @param {object} param0 { noteId, action, payload, baseUpdatedAt }
 * @returns {Promise<number>} seq 序号
 */
export function enqueueMutation({ noteId, action = 'update', payload = {}, baseUpdatedAt = null }) {
    if (!noteId) return Promise.resolve(-1);

    return openLocalDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_MUTATIONS], 'readwrite');
            const store = tx.objectStore(STORE_MUTATIONS);
            const index = store.index('noteId');
            const req = index.getAll(noteId);

            req.onsuccess = () => {
                const existing = req.result || [];
                const updateTask = existing.find(t => t.action === action);

                if (updateTask && action === 'update') {
                    // 合并现有任务，更新 payload 与 timestamp，保持最老 baseUpdatedAt
                    updateTask.payload = {
                        ...updateTask.payload,
                        ...payload
                    };
                    updateTask.timestamp = Date.now();
                    store.put(updateTask);
                    tx.oncomplete = () => resolve(updateTask.seq);
                } else {
                    // 新增突变任务
                    const newTask = {
                        noteId,
                        action,
                        payload,
                        baseUpdatedAt,
                        timestamp: Date.now(),
                        retryCount: 0
                    };
                    const addReq = store.add(newTask);
                    addReq.onsuccess = () => {
                        tx.oncomplete = () => resolve(addReq.result);
                    };
                }
            };

            req.onerror = () => reject(req.error);
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
