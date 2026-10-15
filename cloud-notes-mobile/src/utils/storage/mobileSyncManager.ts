/**
 * mobileSyncManager.ts - 移动端离线突变队列与非破坏性安全分叉增量同步器
 * 遵循 Local-First 原则，按键即落盘 AsyncStorage，后台防抖增量推流，冲突安全分叉
 */

import { AppState, AppStateStatus } from 'react-native';
import { updateNote, createNote, getNoteDetail } from '../../api/notesApi';
import {
  saveNoteCache,
  enqueueMutation,
  dequeueMutation,
  getPendingMutations,
  getPendingMutationCount,
  clearMutationsForNote,
} from './mobileNotesDB';

export type SyncStatusType = 'synced' | 'pending' | 'syncing' | 'offline' | 'conflict';

export interface SyncStateSnapshot {
  status: SyncStatusType;
  isOnline: boolean;
  queuedCount: number;
  lastSyncedAt: Date | null;
  lastConflictNote: any;
}

export type SyncStateSubscriber = (state: SyncStateSnapshot) => void;

class MobileSyncManager {
  private status: SyncStatusType = 'synced';
  private isOnline = true;
  private queuedCount = 0;
  private lastSyncedAt: Date | null = null;
  private lastConflictNote: any = null;
  private subscribers = new Set<SyncStateSubscriber>();
  private isFlushing = false;
  private debounceTimers = new Map<string, any>();
  private lastKnownRemoteUpdatedAt = new Map<string, string>();

  constructor() {
    this.initAppStateListener();
    this.refreshQueuedCount();
  }

  public setLastKnownRemoteUpdatedAt(noteId: string, updatedAt: string) {
    if (noteId && updatedAt) {
      this.lastKnownRemoteUpdatedAt.set(noteId, updatedAt);
    }
  }

  private initAppStateListener() {
    AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App 从后台唤醒切回前台时，自动尝试排空突变队列
        this.flushQueue();
      }
    });
  }

  public subscribe(callback: SyncStateSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.getSnapshot());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public getSnapshot(): SyncStateSnapshot {
    return {
      status: this.status,
      isOnline: this.isOnline,
      queuedCount: this.queuedCount,
      lastSyncedAt: this.lastSyncedAt,
      lastConflictNote: this.lastConflictNote,
    };
  }

  private setStatus(status: SyncStatusType) {
    if (this.status !== status) {
      this.status = status;
      this.notify();
    }
  }

  private notify() {
    const snapshot = this.getSnapshot();
    this.subscribers.forEach(cb => {
      try {
        cb(snapshot);
      } catch (err) {
        console.warn('[MobileSyncManager] Subscriber callback error:', err);
      }
    });
  }

  public async refreshQueuedCount() {
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
   * 按键输入实时落盘本地 AsyncStorage (0 延迟即时落盘)
   */
  public async notifyLocalDirty(
    noteId: string,
    { title, content, baseUpdatedAt }: { title: string; content: string; baseUpdatedAt?: string | null }
  ) {
    if (!noteId) return;

    // 1. 立即持久化到本地 AsyncStorage
    await saveNoteCache({
      id: noteId,
      title,
      content,
      updatedAt: new Date().toISOString(),
      isDirty: true,
    });

    // 2. 状态迁移
    if (!this.isOnline) {
      await enqueueMutation({
        noteId,
        action: 'update',
        payload: { title, content },
        baseUpdatedAt,
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
  public scheduleAutoSync(
    noteId: string,
    noteData: {
      title: string;
      content: string;
      baseUpdatedAt?: string | null;
      notebookId?: string;
      onSyncSuccess?: (res: any) => void;
    },
    delay = 1500
  ) {
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
   * 核心保存同步逻辑
   */
  public async syncNote(
    noteId: string,
    {
      title,
      content,
      baseUpdatedAt,
      notebookId,
    }: { title: string; content: string; baseUpdatedAt?: string | null; notebookId?: string },
    options: { auto?: boolean; silent?: boolean } = {}
  ): Promise<{ success: boolean; localOnly?: boolean; offline?: boolean; forked?: boolean; forkedNote?: any; updatedAt?: string; error?: any }> {
    if (!noteId) return { success: false, error: 'Note ID required' };

    if (this.debounceTimers.has(noteId)) {
      clearTimeout(this.debounceTimers.get(noteId));
      this.debounceTimers.delete(noteId);
    }

    // 无论在线与否，先行稳固持久化到本地
    await saveNoteCache({
      id: noteId,
      title,
      content,
      updatedAt: new Date().toISOString(),
      isDirty: true,
    });

    // 1. 离线状态保底入队
    if (!this.isOnline) {
      await enqueueMutation({
        noteId,
        action: 'update',
        payload: { title, content, notebookId },
        baseUpdatedAt,
      });
      await this.refreshQueuedCount();
      this.setStatus('offline');
      return { success: true, localOnly: true, offline: true };
    }

    // 2. 在线状态推送
    this.setStatus('syncing');

    try {
      // 冲突检测：比对本地已知的远端最新时间戳
      const lastKnown = this.lastKnownRemoteUpdatedAt.get(noteId) || baseUpdatedAt;
      if (lastKnown) {
        try {
          const remoteRes = await getNoteDetail(noteId);
          const remoteNote = remoteRes?.data;
          if (remoteNote && remoteNote.updatedAt) {
            const remoteTime = new Date(remoteNote.updatedAt).getTime();
            const lastKnownTime = new Date(lastKnown).getTime();

            // 只有当远端时间戳严格大于本地已知的最新时间戳且正文分叉时才触发安全分叉
            if (remoteTime > lastKnownTime && remoteNote.content !== content) {
              console.warn('[MobileSyncManager] Concurrent modification detected! Initiating safety fork.');
              const forkedNote = await this.forkConflictNote({
                originalTitle: title || remoteNote.title,
                content,
                notebookId: notebookId || remoteNote.notebookId,
              });

              // 本地原稿重设为干净快照
              await saveNoteCache({
                id: noteId,
                title: remoteNote.title,
                content: remoteNote.content,
                updatedAt: remoteNote.updatedAt,
                lastSavedContent: remoteNote.content,
                lastSyncedAt: new Date().toISOString(),
                isDirty: false,
              });
              await clearMutationsForNote(noteId);
              await this.refreshQueuedCount();

              this.lastKnownRemoteUpdatedAt.set(noteId, remoteNote.updatedAt);
              this.lastConflictNote = forkedNote;
              this.setStatus('conflict');
              return { success: true, forked: true, forkedNote };
            }
          }
        } catch (checkErr) {
          console.warn('[MobileSyncManager] Conflict check non-fatal error:', checkErr);
        }
      }

      // 正式上云更新
      const saveRes = await updateNote(noteId, {
        title,
        content,
      });

      const savedUpdatedAt = saveRes?.data?.updatedAt || new Date().toISOString();
      this.lastKnownRemoteUpdatedAt.set(noteId, savedUpdatedAt);

      await saveNoteCache({
        id: noteId,
        title,
        content,
        updatedAt: savedUpdatedAt,
        lastSavedContent: content,
        lastSyncedAt: new Date().toISOString(),
        isDirty: false,
      });

      await clearMutationsForNote(noteId);
      await this.refreshQueuedCount();

      this.isOnline = true;
      this.lastSyncedAt = new Date();
      this.setStatus('synced');
      return { success: true, localOnly: false, updatedAt: savedUpdatedAt };
    } catch (error) {
      console.warn('[MobileSyncManager] Cloud save failed, enqueueing mutation:', error);

      this.isOnline = false;
      await enqueueMutation({
        noteId,
        action: 'update',
        payload: { title, content, notebookId },
        baseUpdatedAt,
      });
      await this.refreshQueuedCount();

      this.setStatus('offline');
      return { success: false, localOnly: true, error };
    }
  }

  /**
   * 非破坏性冲突安全分叉（100% 零丢稿）
   */
  public async forkConflictNote({
    originalTitle,
    content,
    notebookId,
  }: {
    originalTitle: string;
    content: string;
    notebookId: string;
  }) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const conflictTitle = `[冲突副本] ${originalTitle || '无标题'}_${timeStamp}`;

    const createRes = await createNote({
      title: conflictTitle,
      content,
      notebookId: notebookId || '',
    });

    const createdNote = createRes?.data;
    const noteId = (createdNote as any)?._id || (createdNote as any)?.id;
    if (createdNote && noteId) {
      await saveNoteCache({
        id: noteId,
        title: createdNote.title,
        content: createdNote.content,
        updatedAt: createdNote.updatedAt,
        lastSavedContent: createdNote.content,
        lastSyncedAt: new Date().toISOString(),
        isDirty: false,
      });
    }

    return createdNote;
  }

  /**
   * 恢复联网后排空与重放突变队列
   */
  public async flushQueue() {
    if (this.isFlushing) return;
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
        try {
          const { noteId, payload, baseUpdatedAt, seq } = task;
          const res = await this.syncNote(
            noteId,
            {
              title: payload.title || '',
              content: payload.content || '',
              baseUpdatedAt,
              notebookId: payload.notebookId,
            },
            { auto: true }
          );

          if (res.success) {
            await dequeueMutation(seq);
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      await this.refreshQueuedCount();
      if (this.queuedCount === 0) {
        this.setStatus('synced');
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * 手动触发立即重试同步
   */
  public async retryManual() {
    this.isOnline = true;
    await this.flushQueue();
  }
}

export const mobileSyncManager = new MobileSyncManager();
export default mobileSyncManager;
