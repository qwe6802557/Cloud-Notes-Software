/**
 * syncManager.js - 离线突变队列与非破坏性安全分叉增量同步器
 * 遵循 Local-First 原则，按键即写本地，后台增量上云，断网自愈重放，冲突安全分叉
 */

import { updateNote, createNote, getNoteDetail, getNotebooks, createNotebook } from '@/api/notes';
import {
    saveNoteCache,
    enqueueMutation,
    dequeueMutation,
    getPendingMutations,
    getPendingMutationCount,
    clearMutationsForNote
} from './localNotesDB';
import { localSearchEngine } from '../search/localSearchEngine';

class SyncManager {
    constructor() {
        this.status = 'synced'; // 'synced' | 'pending' | 'syncing' | 'offline' | 'conflict'
        this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
        this.queuedCount = 0;
        this.lastSyncedAt = null;
        this.lastConflictNote = null;
        this.subscribers = new Set();
        this.isFlushing = false;
        this.debounceTimers = new Map(); // noteId -> timer
        this.lastKnownRemoteUpdatedAt = new Map(); // noteId -> string
        this.lastSavedContentMap = new Map(); // noteId -> string (基准正文快照)

        this.initNetworkListeners();
        this.refreshQueuedCount();
    }

    setLastKnownRemoteUpdatedAt(noteId, updatedAt, content) {
        if (noteId) {
            if (updatedAt) {
                this.lastKnownRemoteUpdatedAt.set(noteId, updatedAt);
            }
            if (content !== undefined) {
                this.lastSavedContentMap.set(noteId, content);
            }
        }
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
     * 订阅状态变更
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        // 立即向新订阅者推送当前状态快照
        callback(this.getSnapshot());
        return () => {
            this.subscribers.delete(callback);
        };
    }

    getSnapshot() {
        return {
            status: this.status,
            isOnline: this.isOnline,
            queuedCount: this.queuedCount,
            lastSyncedAt: this.lastSyncedAt,
            lastConflictNote: this.lastConflictNote
        };
    }

    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
            this.notify();
        }
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
            this.queuedCount = await getPendingMutationCount();
            if (this.queuedCount > 0 && this.isOnline && this.status === 'synced') {
                this.setStatus('pending');
            } else if (this.queuedCount === 0 && this.isOnline && this.status === 'pending') {
                this.setStatus('synced');
            } else {
                this.notify();
            }
        } catch {
            this.queuedCount = 0;
        }
    }

    /**
     * 按键实时通知本地脏数据（无防抖，立即落盘本地 IndexedDB）
     */
    async notifyLocalDirty(noteId, { title, content, baseUpdatedAt, isEncrypted, encryptedData }) {
        if (!noteId) return;

        await saveNoteCache({
            id: noteId,
            title,
            content: isEncrypted ? '' : content,
            isEncrypted: Boolean(isEncrypted),
            encryptedData: encryptedData || null,
            updatedAt: new Date().toISOString(),
            isDirty: true
        });

        if (!isEncrypted) {
            localSearchEngine.upsertDocument({
                id: noteId,
                title,
                snippet: content,
                updatedAt: new Date().toISOString()
            });
        }

        // 2. 更新状态指示
        if (!this.isOnline) {
            await enqueueMutation({
                noteId,
                action: 'update',
                payload: { title, content },
                baseUpdatedAt
            });
            await this.refreshQueuedCount();
            this.setStatus('offline');
        } else {
            this.setStatus('pending');
        }
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
            const res = await this.syncNote(noteId, noteData, { auto: true });
            if (res?.success && !res.forked && typeof noteData?.onSyncSuccess === 'function') {
                noteData.onSyncSuccess(res);
            }
        }, delay);

        this.debounceTimers.set(noteId, timer);
    }

    /**
     * 核心保存同步逻辑 (支持手动与自动)
     */
    async syncNote(noteId, { title, content, baseUpdatedAt, isEncrypted, encryptedData }, options = {}) {
        if (!noteId) return { success: false, error: 'Note ID required' };

        // 取消该 note 正在排队的防抖计时器
        if (this.debounceTimers.has(noteId)) {
            clearTimeout(this.debounceTimers.get(noteId));
            this.debounceTimers.delete(noteId);
        }

        // 无论在线与否，首先牢固写入本地持久化
        await saveNoteCache({
            id: noteId,
            title,
            content: isEncrypted ? '' : content,
            isEncrypted: Boolean(isEncrypted),
            encryptedData: encryptedData || null,
            updatedAt: new Date().toISOString(),
            isDirty: true
        });

        if (!isEncrypted) {
            localSearchEngine.upsertDocument({
                id: noteId,
                title,
                snippet: content,
                updatedAt: new Date().toISOString()
            });
        }

        // 1. 若当前离线，直接入队，保证零丢稿
        if (!this.isOnline) {
            await enqueueMutation({
                noteId,
                action: 'update',
                payload: { title, content },
                baseUpdatedAt
            });
            await this.refreshQueuedCount();
            this.setStatus('offline');
            return { success: true, localOnly: true, offline: true };
        }

        // 2. 在线状态，开始推送上云
        this.setStatus('syncing');

        try {
            // 冲突预检：比对云端最新版本
            const lastKnown = this.lastKnownRemoteUpdatedAt.get(noteId) || baseUpdatedAt;
            const lastSavedContent = this.lastSavedContentMap.get(noteId);

            if (lastKnown) {
                try {
                    const remoteRes = await getNoteDetail(noteId);
                    const remoteNote = remoteRes?.note;
                    if (remoteNote && remoteNote.updatedAt) {
                        const remoteTime = new Date(remoteNote.updatedAt).getTime();
                        const lastKnownTime = new Date(lastKnown).getTime();

                        // 核心并发冲突判定规则：
                        // 1. 远端时间戳必须晚于本地已知最新时间戳，给予 1000ms 容差过滤自身网络/时钟微漂移；
                        // 2. 远端正文既不等于当前编辑内容，也不等于本地上一轮落盘成功的基准快照 (lastSavedContent)；
                        //    如果 remoteNote.content === lastSavedContent，说明云端仍是本客户端刚才保存的内容，
                        //    用户正在键盘上持续输入，绝对不是外部并发修改！
                        const isRealExternalConflict = (
                            lastSavedContent !== undefined
                                ? remoteNote.content !== lastSavedContent && remoteNote.content !== content
                                : remoteNote.content !== content
                        );

                        if (remoteTime > (lastKnownTime + 1000) && isRealExternalConflict) {
                            console.warn('[SyncManager] Real concurrent modification detected! Initiating safety fork.');
                            const forkedNote = await this.forkConflictNote({
                                originalTitle: title || remoteNote.title,
                                content,
                                notebookId: remoteNote.notebookId
                            });

                            // 本地原稿重设为干净，已通过分叉副本完整保留
                            await saveNoteCache({
                                id: noteId,
                                title: remoteNote.title,
                                content: remoteNote.content,
                                updatedAt: remoteNote.updatedAt,
                                lastSavedContent: remoteNote.content,
                                lastSyncedAt: new Date().toISOString(),
                                isDirty: false
                            });
                            await clearMutationsForNote(noteId);
                            await this.refreshQueuedCount();

                            this.lastKnownRemoteUpdatedAt.set(noteId, remoteNote.updatedAt);
                            this.lastSavedContentMap.set(noteId, remoteNote.content);
                            this.lastConflictNote = forkedNote;
                            this.setStatus('conflict');
                            return { success: true, forked: true, forkedNote };
                        }
                    }
                } catch (checkErr) {
                    console.warn('[SyncManager] Conflict check non-fatal error:', checkErr);
                }
            }

            // 正式向云端保存
            const savePayload = { title, content: isEncrypted ? '' : content };
            if (isEncrypted !== undefined) savePayload.isEncrypted = isEncrypted;
            if (encryptedData !== undefined) savePayload.encryptedData = encryptedData;

            const saveRes = await updateNote(noteId, savePayload);

            const savedUpdatedAt = saveRes?.note?.updatedAt || new Date().toISOString();
            this.lastKnownRemoteUpdatedAt.set(noteId, savedUpdatedAt);
            this.lastSavedContentMap.set(noteId, content);

            // 更新本地快照为已同步
            await saveNoteCache({
                id: noteId,
                title,
                content: isEncrypted ? '' : content,
                isEncrypted: Boolean(isEncrypted),
                encryptedData: encryptedData || null,
                updatedAt: savedUpdatedAt,
                lastSavedContent: content,
                lastSyncedAt: new Date().toISOString(),
                isDirty: false
            });

            await clearMutationsForNote(noteId);
            await this.refreshQueuedCount();

            this.lastSyncedAt = new Date();
            this.setStatus('synced');
            return { success: true, localOnly: false, updatedAt: savedUpdatedAt, note: saveRes?.note };
        } catch (error) {
            console.error('[SyncManager] Cloud save failed, enqueueing mutation:', error);

            // 网络失败或后端异常，安全入离线突变队列保底
            await enqueueMutation({
                noteId,
                action: 'update',
                payload: { title, content },
                baseUpdatedAt
            });
            await this.refreshQueuedCount();

            this.setStatus('offline');
            return { success: false, localOnly: true, error };
        }
    }

    /**
     * 获取或自动创建专用的「⚠️ 冲突归档」系统笔记本，杜绝污染正常工作目录
     */
    async getConflictNotebookId() {
        try {
            const res = await getNotebooks();
            const list = res?.notebooks || res?.data || (Array.isArray(res) ? res : []);
            const existing = list.find(nb => (nb.name || nb.title) === '⚠️ 冲突归档');
            if (existing) {
                return existing.id || existing._id;
            }
            const createRes = await createNotebook({
                name: '⚠️ 冲突归档',
                title: '⚠️ 冲突归档'
            });
            const created = createRes?.notebook || createRes?.data;
            return created?.id || created?._id || '';
        } catch (e) {
            console.warn('[syncManager] getConflictNotebookId warning:', e);
            return '';
        }
    }

    /**
     * 非破坏性冲突安全分叉（100% 零丢稿，自动归拢至专属冲突归档笔记本）
     */
    async forkConflictNote({ originalTitle, content, notebookId }) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const timeStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
        const conflictTitle = `[冲突副本] ${originalTitle || '无标题'}_${timeStamp}`;

        // 隔离专区策略：冲突副本绝不进入原工作目录，优先归集入「⚠️ 冲突归档」笔记本
        let targetNotebookId = await this.getConflictNotebookId();
        if (!targetNotebookId) {
            targetNotebookId = notebookId;
        }

        const createRes = await createNote({
            title: conflictTitle,
            content,
            notebookId: targetNotebookId
        });

        const createdNote = createRes?.note;
        if (createdNote && createdNote.id) {
            await saveNoteCache({
                id: createdNote.id,
                title: createdNote.title,
                content: createdNote.content,
                updatedAt: createdNote.updatedAt,
                lastSavedContent: createdNote.content,
                lastSyncedAt: new Date().toISOString(),
                isDirty: false
            });
        }

        return createdNote;
    }

    /**
     * 联网后排空与重放突变队列
     */
    async flushQueue() {
        if (this.isFlushing || !this.isOnline) return;
        this.isFlushing = true;

        try {
            const mutations = await getPendingMutations();
            if (mutations.length === 0) {
                await this.refreshQueuedCount();
                this.setStatus('synced');
                return;
            }

            this.setStatus('syncing');

            for (const task of mutations) {
                if (!this.isOnline) break;

                try {
                    const { noteId, payload, baseUpdatedAt, seq } = task;
                    const res = await this.syncNote(noteId, {
                        title: payload.title,
                        content: payload.content,
                        baseUpdatedAt
                    }, { auto: true });

                    if (res.success) {
                        await dequeueMutation(seq);
                    } else {
                        break;
                    }
                } catch (taskErr) {
                    console.error('[SyncManager] Flush task error:', taskErr);
                    break;
                }
            }

            await this.refreshQueuedCount();
            if (this.queuedCount === 0 && this.isOnline) {
                this.setStatus('synced');
            }
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
