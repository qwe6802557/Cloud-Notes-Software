/**
 * syncManager.js - 离线突变队列与显式冲突裁决增量同步器
 * 遵循 Local-First 原则：按键即写本地，后台乐观锁增量上云，断网有序重放，409 显式挂起裁决
 */

import {
    updateNote,
    createNote,
    getNoteDetail,
    getNotebooks,
    createNotebook,
    deleteNote,
    moveNoteNode,
    updateNoteStarred
} from '@/api/notes';
import {
    saveNoteCache,
    deleteNoteCache,
    enqueueMutation,
    dequeueMutation,
    getPendingMutations,
    clearMutationsForNote,
    updateMutationTask,
    remapNoteIdInLocalDB,
    saveConflictRecord,
    getAllConflictRecords,
    deleteConflictRecord
} from './localNotesDB';
import { localSearchEngine } from '../search/localSearchEngine';

const MAX_TASK_RETRY = 3;
const CONFLICT_NOTEBOOK_NAME = '冲突归档';

const isPermanentClientError = err => {
    const status = err?.status || err?.response?.status;
    return status === 400 || status === 403 || status === 404;
};

const isConflictError = err => {
    const status = err?.status || err?.response?.status;
    return status === 409;
};

const normalizeNoteId = note => note?.id || note?._id || '';

class SyncManager {
    constructor() {
        this.status = 'synced'; // 'synced' | 'pending' | 'syncing' | 'offline' | 'conflict'
        this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        this.queuedCount = 0;
        this.lastSyncedAt = null;
        this.lastConflictNote = null;
        this.subscribers = new Set();
        this.noteEventSubscribers = new Set();
        this.isFlushing = false;
        this.debounceTimers = new Map(); // noteId -> timer
        this.lastKnownRemoteUpdatedAt = new Map(); // noteId -> string
        this.contentVersionMap = new Map(); // noteId -> number
        this.lastSavedContentMap = new Map(); // noteId -> string (明文或密文基准快照)
        this.conflictsMap = new Map(); // noteId -> ConflictRecord

        this.initNetworkListeners();
        this.bootstrap();
    }

    /**
     * 冷启动初始化：恢复未解决冲突记录，统计活跃队列并在在线时自动排空重放
     */
    async bootstrap() {
        try {
            const conflicts = await getAllConflictRecords();
            conflicts.forEach(record => {
                if (record && record.noteId) {
                    this.conflictsMap.set(record.noteId, record);
                    this.lastConflictNote = record;
                }
            });
        } catch (err) {
            console.warn('[SyncManager] Hydrate conflicts error:', err);
        }

        await this.refreshQueuedCount();

        if (!this.isOnline) {
            this.setStatus('offline');
            return;
        }

        if (this.conflictsMap.size > 0) {
            this.setStatus('conflict');
        }

        // 在线且存在积压离线突变时自动冷启动排空
        if (this.isOnline && this.queuedCount > 0) {
            this.flushQueue();
        }
    }

    setLastKnownRemoteUpdatedAt(noteId, updatedAt, content, contentVersion) {
        if (!noteId) return;
        if (updatedAt) {
            this.lastKnownRemoteUpdatedAt.set(noteId, updatedAt);
        }
        if (content !== undefined) {
            this.lastSavedContentMap.set(noteId, content);
        }
        if (contentVersion !== undefined && contentVersion !== null) {
            this.contentVersionMap.set(noteId, contentVersion);
        }
    }

    getContentVersion(noteId) {
        return this.contentVersionMap.has(noteId) ? this.contentVersionMap.get(noteId) : null;
    }

    getConflict(noteId) {
        return noteId ? (this.conflictsMap.get(noteId) || null) : null;
    }

    getConflicts() {
        return Array.from(this.conflictsMap.values());
    }

    initNetworkListeners() {
        if (typeof window === 'undefined') return;

        window.addEventListener('online', () => {
            this.isOnline = true;
            this.flushQueue();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.setStatus('offline');
        });
    }

    /**
     * 订阅同步状态变更
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        callback(this.getSnapshot());
        return () => {
            this.subscribers.delete(callback);
        };
    }

    /**
     * 订阅单篇笔记事件（用于主编辑器与副窗双栏状态实时对齐）
     * event: { type: 'dirty' | 'synced' | 'conflict' | 'resolved' | 'remapped', noteId, source, ... }
     */
    subscribeNoteEvents(callback) {
        this.noteEventSubscribers.add(callback);
        return () => {
            this.noteEventSubscribers.delete(callback);
        };
    }

    emitNoteEvent(event) {
        this.noteEventSubscribers.forEach(cb => {
            try {
                cb(event);
            } catch (err) {
                console.error('[SyncManager] Note event callback error:', err);
            }
        });
    }

    getSnapshot() {
        const conflicts = this.getConflicts();
        return {
            status: this.status,
            isOnline: this.isOnline,
            queuedCount: this.queuedCount,
            lastSyncedAt: this.lastSyncedAt,
            lastConflictNote: this.lastConflictNote || conflicts[0] || null,
            conflicts,
            conflictCount: conflicts.length
        };
    }

    recomputeStatus(preferredStatus = null) {
        if (!this.isOnline) {
            this.setStatus('offline');
            return;
        }
        if (preferredStatus === 'syncing') {
            this.setStatus('syncing');
            return;
        }
        if (this.conflictsMap.size > 0) {
            this.setStatus('conflict');
            return;
        }
        if (this.queuedCount > 0) {
            this.setStatus('pending');
            return;
        }
        if (preferredStatus) {
            this.setStatus(preferredStatus);
        } else {
            this.setStatus('synced');
        }
    }

    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
        }
        this.notify();
    }

    notify() {
        const snapshot = this.getSnapshot();
        this.subscribers.forEach(cb => {
            try {
                cb(snapshot);
            } catch (err) {
                console.error('[SyncManager] Subscriber callback error:', err);
            }
        });
    }

    async refreshQueuedCount() {
        try {
            const list = await getPendingMutations();
            const active = list.filter(
                t => t.status !== 'failed' && t.status !== 'blocked_409' && (t.retryCount || 0) < MAX_TASK_RETRY
            );
            this.queuedCount = active.length;
            this.recomputeStatus(this.status === 'pending' ? 'pending' : null);
        } catch {
            this.queuedCount = 0;
        }
    }

    /**
     * 取消指定笔记尚未执行的防抖定时器与待同步排队任务（用于放弃编辑、切笔记本或删除前清理）
     * @param {string} noteId
     * @param {object} [options] - { keepQueue?: boolean }
     */
    async cancelNotePendingSync(noteId, options = {}) {
        if (!noteId) return;
        if (this.debounceTimers.has(noteId)) {
            clearTimeout(this.debounceTimers.get(noteId));
            this.debounceTimers.delete(noteId);
        }
        if (!options.keepQueue) {
            await clearMutationsForNote(noteId);
            await this.refreshQueuedCount();
        }
    }

    /**
     * 构造安全持久化/传输载荷：加密笔记严禁暴露明文 content
     */
    buildSafePayload({ title, content, isEncrypted, encryptedData, notebookId, parentId, type, noteType, clientId }) {
        const encrypted = Boolean(isEncrypted);
        const payload = {
            title,
            content: encrypted ? '' : (content ?? ''),
            isEncrypted: encrypted
        };
        if (encryptedData !== undefined) {
            payload.encryptedData = encryptedData;
        }
        if (notebookId !== undefined) payload.notebookId = notebookId;
        if (parentId !== undefined) payload.parentId = parentId;
        if (type !== undefined || noteType !== undefined) payload.type = type || noteType;
        if (clientId !== undefined) payload.clientId = clientId;
        return payload;
    }

    /**
     * 按键实时通知本地脏数据（无防抖立即落盘 IndexedDB，绝不覆盖 remoteUpdatedAt 与 contentVersion）
     */
    async notifyLocalDirty(noteId, noteData = {}) {
        if (!noteId) return;
        const {
            title,
            content,
            baseUpdatedAt,
            expectedVersion,
            isEncrypted,
            encryptedData,
            notebookId,
            source = 'primary'
        } = noteData;

        const encrypted = Boolean(isEncrypted);
        const safePayload = this.buildSafePayload({
            title,
            content,
            isEncrypted: encrypted,
            encryptedData,
            notebookId
        });

        await saveNoteCache({
            id: noteId,
            title,
            content: safePayload.content,
            isEncrypted: encrypted,
            encryptedData: encryptedData !== undefined ? encryptedData : undefined,
            updatedAt: new Date().toISOString(),
            isDirty: true
        });

        if (!encrypted) {
            localSearchEngine.upsertDocument({
                id: noteId,
                title,
                snippet: content,
                updatedAt: new Date().toISOString()
            });
        }

        if (!this.isOnline) {
            const isLocalTemp = String(noteId).startsWith('local_');
            await enqueueMutation({
                noteId,
                action: isLocalTemp ? 'create' : 'update',
                payload: safePayload,
                baseUpdatedAt: baseUpdatedAt || this.lastKnownRemoteUpdatedAt.get(noteId) || null,
                expectedVersion: expectedVersion ?? this.getContentVersion(noteId),
                clientId: isLocalTemp ? noteId : undefined
            });
            await this.refreshQueuedCount();
            this.setStatus('offline');
        } else {
            this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'pending');
        }

        this.emitNoteEvent({
            type: 'dirty',
            noteId,
            source,
            title,
            content: safePayload.content,
            isEncrypted: encrypted,
            encryptedData: encryptedData || null
        });
    }

    /**
     * 防抖增量上云同步（默认 1.5s 防抖）
     */
    scheduleAutoSync(noteId, noteData, delay = 1500) {
        if (!noteId) return;

        if (this.debounceTimers.has(noteId)) {
            clearTimeout(this.debounceTimers.get(noteId));
        }

        const timer = setTimeout(async () => {
            this.debounceTimers.delete(noteId);
            const res = await this.syncNote(noteId, noteData, { auto: true, saveType: 'auto' });
            if (res?.success && !res.conflict && typeof noteData?.onSyncSuccess === 'function') {
                noteData.onSyncSuccess(res);
            }
        }, delay);

        this.debounceTimers.set(noteId, timer);
    }

    /**
     * 登记显式冲突（绝不自动分叉或覆盖本地/IDB），进入 'conflict' 状态等待用户在弹窗裁决
     */
    async enterConflictState({
        noteId,
        title,
        content,
        isEncrypted,
        encryptedData,
        expectedVersion,
        serverNote,
        message
    }) {
        const encrypted = Boolean(isEncrypted || serverNote?.isEncrypted);
        let resolvedServerNote = serverNote || null;

        if (!resolvedServerNote) {
            try {
                const detailRes = await getNoteDetail(noteId, { skipErrorToast: true });
                resolvedServerNote = detailRes?.note || null;
            } catch (fetchErr) {
                console.warn('[SyncManager] Fetch serverNote on 409 warning:', fetchErr);
            }
        }

        const conflictRecord = {
            noteId,
            title: title || resolvedServerNote?.title || '无标题笔记',
            localDraft: {
                title: title ?? '',
                content: encrypted ? '' : (content ?? ''),
                isEncrypted: encrypted,
                encryptedData: encryptedData || null,
                updatedAt: new Date().toISOString()
            },
            serverNote: resolvedServerNote,
            isEncrypted: encrypted,
            expectedVersion: expectedVersion ?? this.getContentVersion(noteId),
            serverVersion: resolvedServerNote?.contentVersion ?? null,
            message: message || '检测到云端版本已发生变更，请选择冲突裁决方案',
            detectedAt: new Date().toISOString()
        };

        this.conflictsMap.set(noteId, conflictRecord);
        this.lastConflictNote = conflictRecord;
        await saveConflictRecord(conflictRecord);

        // 保留本地脏草稿快照，禁止覆盖为云端版本
        await saveNoteCache({
            id: noteId,
            title: conflictRecord.localDraft.title,
            content: conflictRecord.localDraft.content,
            isEncrypted: encrypted,
            encryptedData: conflictRecord.localDraft.encryptedData,
            updatedAt: conflictRecord.localDraft.updatedAt,
            isDirty: true
        });

        this.setStatus('conflict');
        this.emitNoteEvent({
            type: 'conflict',
            noteId,
            conflict: conflictRecord
        });

        return conflictRecord;
    }

    /**
     * 统一保存入口别名：pushNoteUpdate 委托给 syncNote
     */
    pushNoteUpdate(noteId, noteData, options = {}) {
        return this.syncNote(noteId, noteData, options);
    }

    /**
     * 核心保存同步逻辑（携带 expectedVersion，409 严格进入冲突态，离线自动入队）
     */
    async syncNote(noteId, noteData = {}, options = {}) {
        if (!noteId) return { success: false, error: 'Note ID required' };

        const {
            title,
            content,
            baseUpdatedAt,
            expectedVersion,
            isEncrypted,
            encryptedData,
            notebookId,
            parentId,
            type,
            noteType,
            clientId,
            saveType,
            source = 'primary'
        } = noteData;

        // 取消正在等待的防抖定时器
        if (this.debounceTimers.has(noteId)) {
            clearTimeout(this.debounceTimers.get(noteId));
            this.debounceTimers.delete(noteId);
        }

        const encrypted = Boolean(isEncrypted);
        const safePayload = this.buildSafePayload({
            title,
            content,
            isEncrypted: encrypted,
            encryptedData,
            notebookId,
            parentId,
            type,
            noteType,
            clientId
        });

        // 1. 若该笔记正处于未解决冲突态且非强制覆盖，仅更新冲突记录内本地草稿并返回冲突标记
        if (this.conflictsMap.has(noteId) && !options.force) {
            const conflictRecord = await this.enterConflictState({
                noteId,
                title,
                content,
                isEncrypted: encrypted,
                encryptedData,
                expectedVersion,
                serverNote: this.conflictsMap.get(noteId)?.serverNote,
                message: this.conflictsMap.get(noteId)?.message
            });
            return { success: false, conflict: true, conflictRecord };
        }

        // 2. 无论在线与否，首先安全落盘本地 IndexedDB（保留原 remoteUpdatedAt 与 contentVersion）
        await saveNoteCache({
            id: noteId,
            title,
            content: safePayload.content,
            isEncrypted: encrypted,
            encryptedData: encryptedData !== undefined ? encryptedData : undefined,
            updatedAt: new Date().toISOString(),
            isDirty: true
        });

        if (!encrypted) {
            localSearchEngine.upsertDocument({
                id: noteId,
                title,
                snippet: content,
                updatedAt: new Date().toISOString()
            });
        }

        const isLocalTemp = String(noteId).startsWith('local_');
        const resolvedExpectedVersion = expectedVersion ?? this.getContentVersion(noteId);

        // 3. 离线直接入队保底
        if (!this.isOnline) {
            await enqueueMutation({
                noteId,
                action: isLocalTemp ? 'create' : 'update',
                payload: safePayload,
                baseUpdatedAt: baseUpdatedAt || this.lastKnownRemoteUpdatedAt.get(noteId) || null,
                expectedVersion: resolvedExpectedVersion,
                clientId: isLocalTemp ? (clientId || noteId) : undefined
            });
            await this.refreshQueuedCount();
            this.setStatus('offline');
            return { success: true, localOnly: true, offline: true };
        }

        this.setStatus('syncing');

        try {
            // 4. 离线临时创建的 local_ 笔记首次上云：幂等 create 并原子重映射 ID
            if (isLocalTemp) {
                const createPayload = {
                    ...safePayload,
                    clientId: clientId || noteId
                };
                const createRes = await createNote(createPayload, { skipErrorToast: true });
                const createdNote = createRes?.note || createRes;
                const realId = normalizeNoteId(createdNote);

                if (realId) {
                    const savedUpdatedAt = createdNote.updatedAt || new Date().toISOString();
                    const nextVersion = createdNote.contentVersion ?? 1;
                    this.setLastKnownRemoteUpdatedAt(
                        realId,
                        savedUpdatedAt,
                        encrypted ? (encryptedData || '') : (content ?? ''),
                        nextVersion
                    );

                    await remapNoteIdInLocalDB(noteId, realId, {
                        ...createdNote,
                        id: realId,
                        content: encrypted ? '' : (content ?? ''),
                        isEncrypted: encrypted,
                        encryptedData: encryptedData || null,
                        contentVersion: nextVersion,
                        remoteUpdatedAt: savedUpdatedAt,
                        lastSavedContent: encrypted ? '' : (content ?? ''),
                        lastSyncedAt: new Date().toISOString(),
                        isDirty: false
                    });

                    if (!options.fromQueue) {
                        await clearMutationsForNote(noteId);
                        await clearMutationsForNote(realId);
                    }
                    await this.refreshQueuedCount();
                    this.lastSyncedAt = new Date();
                    this.recomputeStatus();

                    this.emitNoteEvent({
                        type: 'remapped',
                        tempId: noteId,
                        realId,
                        noteId: realId,
                        note: createdNote,
                        source
                    });

                    return {
                        success: true,
                        localOnly: false,
                        remapped: true,
                        tempId: noteId,
                        realId,
                        updatedAt: savedUpdatedAt,
                        contentVersion: nextVersion,
                        note: createdNote
                    };
                }
            }

            // 5. 若尚未拿到服务端 contentVersion，降级保留旧版时间+快照预检（禁止自动分叉）
            const lastKnown = this.lastKnownRemoteUpdatedAt.get(noteId) || baseUpdatedAt;
            const lastSavedSnapshot = this.lastSavedContentMap.get(noteId);
            const currentSnapshot = encrypted ? (encryptedData || '') : (content ?? '');

            if (resolvedExpectedVersion == null && lastKnown && !options.force) {
                try {
                    const remoteRes = await getNoteDetail(noteId, { skipErrorToast: true });
                    const remoteNote = remoteRes?.note;
                    if (remoteNote && remoteNote.updatedAt) {
                        const remoteTime = new Date(remoteNote.updatedAt).getTime();
                        const lastKnownTime = new Date(lastKnown).getTime();
                        const remoteSnapshot = remoteNote.isEncrypted
                            ? (remoteNote.encryptedData || '')
                            : (remoteNote.content ?? '');

                        const isRealExternalConflict = (
                            lastSavedSnapshot !== undefined
                                ? remoteSnapshot !== lastSavedSnapshot && remoteSnapshot !== currentSnapshot
                                : remoteSnapshot !== currentSnapshot
                        );

                        if (remoteTime > (lastKnownTime + 1000) && isRealExternalConflict) {
                            const conflictRecord = await this.enterConflictState({
                                noteId,
                                title,
                                content,
                                isEncrypted: encrypted,
                                encryptedData,
                                expectedVersion: resolvedExpectedVersion,
                                serverNote: remoteNote,
                                message: '检测到云端存在外部更新，为防止覆盖已挂起等待裁决'
                            });
                            return { success: false, conflict: true, conflictRecord };
                        }
                    }
                } catch (checkErr) {
                    console.warn('[SyncManager] Fallback conflict precheck warning:', checkErr);
                }
            }

            // 6. 正式携带 expectedVersion 推送更新
            const requestBody = {
                title,
                content: safePayload.content,
                isEncrypted: encrypted,
                saveType: saveType || options.saveType || (options.auto ? 'auto' : 'manual')
            };
            if (encryptedData !== undefined) requestBody.encryptedData = encryptedData;
            if (resolvedExpectedVersion !== null && resolvedExpectedVersion !== undefined) {
                requestBody.expectedVersion = resolvedExpectedVersion;
            }
            if (options.force) {
                requestBody.force = true;
            }

            const saveRes = await updateNote(noteId, requestBody, { skipErrorToast: true });
            const savedNote = saveRes?.note || saveRes;
            const savedUpdatedAt = savedNote?.updatedAt || new Date().toISOString();
            const nextVersion = savedNote?.contentVersion ?? (
                resolvedExpectedVersion != null ? resolvedExpectedVersion + 1 : undefined
            );

            this.setLastKnownRemoteUpdatedAt(noteId, savedUpdatedAt, currentSnapshot, nextVersion);

            if (this.conflictsMap.has(noteId)) {
                this.conflictsMap.delete(noteId);
                await deleteConflictRecord(noteId);
            }

            await saveNoteCache({
                id: noteId,
                title,
                content: safePayload.content,
                isEncrypted: encrypted,
                encryptedData: encryptedData !== undefined ? encryptedData : undefined,
                contentVersion: nextVersion,
                remoteUpdatedAt: savedUpdatedAt,
                updatedAt: savedUpdatedAt,
                lastSavedContent: safePayload.content,
                lastSyncedAt: new Date().toISOString(),
                isDirty: false
            });

            if (!options.fromQueue) {
                // 仅清掉冗余 update 任务，保留待重放的 move/star 等其他队列项
                const pending = await getPendingMutations();
                await Promise.all(
                    pending
                        .filter(t => t.noteId === noteId && t.action === 'update')
                        .map(t => dequeueMutation(t.seq))
                );
            }

            await this.refreshQueuedCount();
            this.lastSyncedAt = new Date();
            this.recomputeStatus();

            this.emitNoteEvent({
                type: 'synced',
                noteId,
                source,
                updatedAt: savedUpdatedAt,
                contentVersion: nextVersion,
                note: savedNote,
                draft: {
                    title,
                    content: safePayload.content,
                    isEncrypted: encrypted,
                    encryptedData: encryptedData || null
                }
            });

            return {
                success: true,
                localOnly: false,
                updatedAt: savedUpdatedAt,
                contentVersion: nextVersion,
                note: savedNote
            };
        } catch (error) {
            if (isConflictError(error)) {
                const conflictRecord = await this.enterConflictState({
                    noteId,
                    title,
                    content,
                    isEncrypted: encrypted,
                    encryptedData,
                    expectedVersion: resolvedExpectedVersion,
                    serverNote: error.conflictData?.serverNote || null,
                    message: error.responseData?.message || error.message
                });
                return { success: false, conflict: true, conflictRecord, error };
            }

            if (isPermanentClientError(error)) {
                console.error('[SyncManager] Permanent 4xx sync error:', error);
                this.recomputeStatus();
                return { success: false, permanentError: true, error };
            }

            console.error('[SyncManager] Cloud save failed, enqueueing mutation:', error);

            if (!options.fromQueue) {
                await enqueueMutation({
                    noteId,
                    action: isLocalTemp ? 'create' : 'update',
                    payload: safePayload,
                    baseUpdatedAt: baseUpdatedAt || this.lastKnownRemoteUpdatedAt.get(noteId) || null,
                    expectedVersion: resolvedExpectedVersion,
                    clientId: isLocalTemp ? (clientId || noteId) : undefined
                });
                await this.refreshQueuedCount();
            }

            this.setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'pending');
            return { success: false, localOnly: true, error };
        }
    }

    /**
     * 获取或自动创建专用的「冲突归档」系统笔记本，杜绝污染正常工作目录
     */
    async getConflictNotebookId() {
        try {
            const res = await getNotebooks();
            const list = res?.notebooks || res?.data || (Array.isArray(res) ? res : []);
            const existing = list.find(nb => {
                const label = nb.name || nb.title;
                return label === CONFLICT_NOTEBOOK_NAME || label === '⚠️ 冲突归档';
            });
            if (existing) {
                return existing.id || existing._id;
            }
            const createRes = await createNotebook({
                name: CONFLICT_NOTEBOOK_NAME,
                title: CONFLICT_NOTEBOOK_NAME
            });
            const created = createRes?.notebook || createRes?.data;
            return created?.id || created?._id || '';
        } catch (e) {
            console.warn('[SyncManager] getConflictNotebookId warning:', e);
            return '';
        }
    }

    /**
     * 创建独立冲突副本（仅在用户主动选择「另存冲突副本」时调用，完整保留加密状态）
     */
    async forkConflictNote({ originalTitle, content, isEncrypted, encryptedData, notebookId }) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
        const conflictTitle = `[冲突副本] ${originalTitle || '无标题'}_${timeStamp}`;

        let targetNotebookId = await this.getConflictNotebookId();
        if (!targetNotebookId) {
            targetNotebookId = notebookId;
        }

        const encrypted = Boolean(isEncrypted);
        const createRes = await createNote({
            title: conflictTitle,
            content: encrypted ? '' : (content ?? ''),
            isEncrypted: encrypted,
            encryptedData: encrypted ? (encryptedData || null) : null,
            notebookId: targetNotebookId
        }, { skipErrorToast: true });

        const createdNote = createRes?.note || createRes;
        const createdId = normalizeNoteId(createdNote);
        if (createdNote && createdId) {
            await saveNoteCache({
                id: createdId,
                title: createdNote.title,
                content: encrypted ? '' : (createdNote.content ?? ''),
                isEncrypted: Boolean(createdNote.isEncrypted ?? encrypted),
                encryptedData: createdNote.encryptedData || encryptedData || null,
                contentVersion: createdNote.contentVersion,
                remoteUpdatedAt: createdNote.updatedAt,
                updatedAt: createdNote.updatedAt,
                lastSavedContent: encrypted ? '' : (createdNote.content ?? ''),
                lastSyncedAt: new Date().toISOString(),
                isDirty: false
            });
        }

        return createdNote;
    }

    /**
     * 显式裁决冲突：
     * - keep_local: 强制以本地（或弹窗合并后）草稿覆盖云端（force: true）
     * - use_server: 放弃本地冲突草稿，同步落盘云端最新版本
     * - fork_copy: 将本地冲突草稿另存为「冲突归档」副本，并将原笔记切换回云端版本
     */
    async resolveConflict(noteId, strategy, resolvedDraft = null) {
        if (!noteId) return { success: false, error: 'Note ID required' };
        const conflict = this.conflictsMap.get(noteId);

        if (strategy === 'keep_local') {
            const draft = resolvedDraft || conflict?.localDraft;
            if (!draft) return { success: false, error: 'Missing local draft for resolution' };

            const res = await this.syncNote(
                noteId,
                {
                    title: draft.title,
                    content: draft.isEncrypted ? '' : (draft.content ?? ''),
                    isEncrypted: Boolean(draft.isEncrypted),
                    encryptedData: draft.encryptedData ?? null,
                    saveType: 'conflict',
                    source: 'conflict-modal'
                },
                { force: true, saveType: 'conflict' }
            );

            if (res.success) {
                this.conflictsMap.delete(noteId);
                if (this.lastConflictNote?.noteId === noteId) {
                    this.lastConflictNote = this.getConflicts()[0] || null;
                }
                await deleteConflictRecord(noteId);
                await clearMutationsForNote(noteId);
                await this.refreshQueuedCount();
                this.recomputeStatus();
                this.emitNoteEvent({
                    type: 'resolved',
                    strategy: 'keep_local',
                    noteId,
                    note: res.note,
                    draft
                });
            }
            return res;
        }

        // 'use_server' 或 'fork_copy' 均需要最新 serverNote
        let serverNote = conflict?.serverNote || null;
        if (!serverNote) {
            try {
                const remoteRes = await getNoteDetail(noteId, { skipErrorToast: true });
                serverNote = remoteRes?.note || null;
            } catch (err) {
                return { success: false, error: err };
            }
        }
        if (!serverNote) {
            return { success: false, error: '无法获取云端版本' };
        }

        let forkedNote = null;
        if (strategy === 'fork_copy') {
            const draft = resolvedDraft || conflict?.localDraft;
            forkedNote = await this.forkConflictNote({
                originalTitle: draft?.title || serverNote.title,
                content: draft?.content ?? '',
                isEncrypted: Boolean(draft?.isEncrypted),
                encryptedData: draft?.encryptedData || null,
                notebookId: serverNote.notebookId
            });
        }

        const serverEncrypted = Boolean(serverNote.isEncrypted);
        const serverSnapshot = serverEncrypted ? (serverNote.encryptedData || '') : (serverNote.content ?? '');

        await saveNoteCache({
            id: noteId,
            title: serverNote.title,
            content: serverEncrypted ? '' : (serverNote.content ?? ''),
            isEncrypted: serverEncrypted,
            encryptedData: serverNote.encryptedData || null,
            contentVersion: serverNote.contentVersion,
            remoteUpdatedAt: serverNote.updatedAt,
            updatedAt: serverNote.updatedAt,
            lastSavedContent: serverEncrypted ? '' : (serverNote.content ?? ''),
            lastSyncedAt: new Date().toISOString(),
            isDirty: false
        });

        this.setLastKnownRemoteUpdatedAt(
            noteId,
            serverNote.updatedAt,
            serverSnapshot,
            serverNote.contentVersion
        );

        if (!serverEncrypted) {
            localSearchEngine.upsertDocument({
                id: noteId,
                title: serverNote.title,
                snippet: serverNote.content ?? '',
                updatedAt: serverNote.updatedAt
            });
        }

        this.conflictsMap.delete(noteId);
        if (this.lastConflictNote?.noteId === noteId) {
            this.lastConflictNote = this.getConflicts()[0] || null;
        }
        await deleteConflictRecord(noteId);
        await clearMutationsForNote(noteId);
        await this.refreshQueuedCount();
        this.recomputeStatus();

        this.emitNoteEvent({
            type: 'resolved',
            strategy,
            noteId,
            note: serverNote,
            forkedNote
        });

        return {
            success: true,
            strategy,
            note: serverNote,
            forkedNote
        };
    }

    /**
     * 入队结构化变更（delete / move / star）以便离线重放或联网直达
     */
    async enqueueStructuredMutation({ noteId, action, payload = {} }) {
        if (!noteId || !action) return { success: false };
        await enqueueMutation({ noteId, action, payload });
        await this.refreshQueuedCount();
        if (this.isOnline) {
            this.flushQueue();
        } else {
            this.setStatus('offline');
        }
        return { success: true };
    }

    /**
     * 联网后按严格 seq 顺序排空与重放突变队列：
     * - 支持 'create' | 'update' | 'delete' | 'move' | 'star'
     * - create 成功立即原地重映射 local_ ID，保证同队列后续任务可用新 ID
     * - 遇到单篇 409 / 永久 4xx / >3 次重试，跳过该任务继续重放后续队列（绝不阻塞队头）
     */
    async flushQueue() {
        if (this.isFlushing || !this.isOnline) return;
        this.isFlushing = true;

        try {
            const mutations = await getPendingMutations();
            const activeTasks = mutations.filter(
                t => t.status !== 'failed' && t.status !== 'blocked_409' && (t.retryCount || 0) < MAX_TASK_RETRY
            );

            if (activeTasks.length === 0) {
                await this.refreshQueuedCount();
                this.recomputeStatus();
                return;
            }

            this.setStatus('syncing');

            // 按 seq 顺序执行，支持 create 成功后把同批内存中的后续 tempId 映射为 realId
            const idAliasMap = new Map();

            for (const task of activeTasks) {
                if (!this.isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) {
                    this.isOnline = false;
                    break;
                }

                const effectiveNoteId = idAliasMap.get(task.noteId) || task.noteId;
                const { seq, action, payload = {}, baseUpdatedAt, expectedVersion, clientId } = task;

                try {
                    if (action === 'create' || (action === 'update' && String(effectiveNoteId).startsWith('local_'))) {
                        const res = await this.syncNote(
                            effectiveNoteId,
                            { ...payload, baseUpdatedAt, expectedVersion, clientId: clientId || effectiveNoteId },
                            { auto: true, fromQueue: true, saveType: 'auto' }
                        );

                        if (res.success) {
                            await dequeueMutation(seq);
                            if (res.realId && res.realId !== effectiveNoteId) {
                                idAliasMap.set(effectiveNoteId, res.realId);
                            }
                            continue;
                        }
                        if (res.conflict || res.permanentError) {
                            await dequeueMutation(seq);
                            continue;
                        }
                    } else if (action === 'update') {
                        const res = await this.syncNote(
                            effectiveNoteId,
                            { ...payload, baseUpdatedAt, expectedVersion },
                            { auto: true, fromQueue: true, saveType: 'auto' }
                        );

                        if (res.success) {
                            await dequeueMutation(seq);
                            continue;
                        }
                        if (res.conflict) {
                            // 已存入 conflictsMap 与 STORE_CONFLICTS，移除该 update 任务避免队列卡死，继续重放其余笔记
                            await dequeueMutation(seq);
                            continue;
                        }
                        if (res.permanentError) {
                            await updateMutationTask(seq, { status: 'failed', lastError: res.error?.message || '4xx' });
                            continue;
                        }
                    } else if (action === 'delete') {
                        if (!String(effectiveNoteId).startsWith('local_')) {
                            await deleteNote(effectiveNoteId, { skipErrorToast: true });
                            await deleteNoteCache(effectiveNoteId);
                        }
                        await dequeueMutation(seq);
                        continue;
                    } else if (action === 'move') {
                        await moveNoteNode(effectiveNoteId, payload, { skipErrorToast: true });
                        await dequeueMutation(seq);
                        continue;
                    } else if (action === 'star') {
                        await updateNoteStarred(effectiveNoteId, Boolean(payload.isStarred), { skipErrorToast: true });
                        await dequeueMutation(seq);
                        continue;
                    }

                    // 未成功且非永久/冲突错：累计重试次数，超限跳过以解除队头阻塞
                    const nextRetry = (task.retryCount || 0) + 1;
                    await updateMutationTask(seq, {
                        retryCount: nextRetry,
                        status: nextRetry >= MAX_TASK_RETRY ? 'failed' : 'pending',
                        lastError: 'retry_scheduled'
                    });
                } catch (taskErr) {
                    if (isConflictError(taskErr)) {
                        await this.enterConflictState({
                            noteId: effectiveNoteId,
                            title: payload?.title,
                            content: payload?.content,
                            isEncrypted: payload?.isEncrypted,
                            encryptedData: payload?.encryptedData,
                            expectedVersion,
                            serverNote: taskErr.conflictData?.serverNote || null,
                            message: taskErr.responseData?.message || taskErr.message
                        });
                        await dequeueMutation(seq);
                        continue;
                    }

                    if (isPermanentClientError(taskErr)) {
                        await updateMutationTask(seq, {
                            status: 'failed',
                            lastError: taskErr.message || 'permanent_4xx'
                        });
                        continue;
                    }

                    const nextRetry = (task.retryCount || 0) + 1;
                    await updateMutationTask(seq, {
                        retryCount: nextRetry,
                        status: nextRetry >= MAX_TASK_RETRY ? 'failed' : 'pending',
                        lastError: taskErr.message || 'network_error'
                    });
                    console.warn(`[SyncManager] Flush task seq=${seq} error (retry ${nextRetry}):`, taskErr);

                    if (typeof navigator !== 'undefined' && !navigator.onLine) {
                        this.isOnline = false;
                        break;
                    }
                }
            }

            await this.refreshQueuedCount();
            this.recomputeStatus();
        } finally {
            this.isFlushing = false;
        }
    }

    /**
     * 用户手动触发立即重试同步
     */
    async retryManual() {
        this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        await this.flushQueue();
    }
}

// 导出全局单例
export const syncManager = new SyncManager();
export default syncManager;
