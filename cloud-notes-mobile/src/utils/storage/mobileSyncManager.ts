/**
 * mobileSyncManager.ts - 移动端离线突变队列与非破坏性安全分叉增量同步器
 * 遵循 Local-First 原则，按键即落盘 AsyncStorage，后台防抖增量推流，冲突安全分叉
 */

import { AppState, AppStateStatus } from 'react-native';
import {
  updateNote,
  createNote,
  getNoteDetail,
  getNotebooks,
  createNotebook,
  deleteNote,
  updateNoteStarred,
  moveNote,
} from '../../api/notesApi';
import axiosInstance, { setOnNetworkStateChange } from '../../api/client';
import {
  resolveNoteId,
  getNoteCache,
  saveNoteCache,
  deleteNoteCache,
  createOfflineNote,
  remapLocalNoteId,
  enqueueMutation,
  dequeueMutation,
  getPendingMutations,
  getPendingMutationCount,
  clearMutationsForNote,
  incrementMutationRetry,
  getSavedConflicts,
  saveConflicts,
  StoredConflictItem,
  OfflineMutationAction,
  OfflineMutation,
} from './mobileNotesDB';
import { mobileSearchEngine } from '../search/mobileSearchEngine';

export type SyncStatusType = 'synced' | 'pending' | 'syncing' | 'offline' | 'conflict';
export type ConflictStrategy = 'keep_local' | 'use_server' | 'fork_copy';

export type ConflictEntry = StoredConflictItem;

export interface SyncStateSnapshot {
  status: SyncStatusType;
  isOnline: boolean;
  queuedCount: number;
  lastSyncedAt: Date | null;
  lastConflictNote: any;
  conflicts: ConflictEntry[];
}

export type SyncStateSubscriber = (state: SyncStateSnapshot) => void;
export type ConflictResolvedListener = (noteId: string, strategy: ConflictStrategy) => void;

class MobileSyncManager {
  private status: SyncStatusType = 'synced';
  private isOnline = true;
  private queuedCount = 0;
  private lastSyncedAt: Date | null = null;
  private lastConflictNote: any = null;
  private conflictsMap = new Map<string, ConflictEntry>();
  private subscribers = new Set<SyncStateSubscriber>();
  private conflictResolvedListeners = new Set<ConflictResolvedListener>();
  private isFlushing = false;
  private debounceTimers = new Map<string, any>();
  private lastKnownRemoteUpdatedAt = new Map<string, string>();
  private lastKnownVersionMap = new Map<string, number>();
  private lastSavedContentMap = new Map<string, string>();

  constructor() {
    this.initAppStateListener();
    setOnNetworkStateChange((online: boolean) => {
      this.setOnline(online);
    });
    void this.initSyncState();
  }

  private async initSyncState() {
    try {
      const saved = await getSavedConflicts();
      for (const item of saved) {
        if (item?.noteId) {
          this.conflictsMap.set(item.noteId, item);
        }
      }
      if (saved.length > 0) {
        this.lastConflictNote = saved[saved.length - 1].serverNote || saved[saved.length - 1];
      }
    } catch {}
    await this.refreshQueuedCount();
    await this.probeNetwork();
  }

  public setOnline(online: boolean) {
    const changed = this.isOnline !== online;
    this.isOnline = online;

    if (!online) {
      if (changed || this.status !== 'offline') {
        this.setStatus('offline');
      }
      return;
    }

    if (this.queuedCount > 0 && !this.isFlushing) {
      if (this.conflictsMap.size === 0) {
        this.setStatus('pending');
      }
      void this.flushQueue();
      return;
    }

    if (this.conflictsMap.size > 0) {
      this.setStatus('conflict');
    } else if (changed || this.status === 'offline') {
      this.setStatus('synced');
    }
  }

  public async probeNetwork(): Promise<boolean> {
    try {
      await axiosInstance.get('/app/check-update', { timeout: 3000 });
      this.setOnline(true);
      return true;
    } catch (err: any) {
      if (err?.status === undefined && !err?.response) {
        this.setOnline(false);
        return false;
      }
      this.setOnline(true);
      return true;
    }
  }

  public setLastKnownRemoteUpdatedAt(
    noteId: string,
    updatedAt: string,
    content?: string,
    contentVersion?: number
  ) {
    if (noteId) {
      if (updatedAt) {
        this.lastKnownRemoteUpdatedAt.set(noteId, updatedAt);
      }
      if (content !== undefined) {
        this.lastSavedContentMap.set(noteId, content);
      }
      if (typeof contentVersion === 'number') {
        this.lastKnownVersionMap.set(noteId, contentVersion);
      }
    }
  }

  public setLastKnownRemoteVersion(noteId: string, contentVersion?: number) {
    if (noteId && typeof contentVersion === 'number') {
      this.lastKnownVersionMap.set(noteId, contentVersion);
    }
  }

  private initAppStateListener() {
    AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        this.probeNetwork();
      }
    });

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => this.setOnline(true));
      window.addEventListener('offline', () => this.setOnline(false));
    }
  }

  public subscribe(callback: SyncStateSubscriber): () => void {
    this.subscribers.add(callback);
    callback(this.getSnapshot());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  public subscribeConflictResolved(callback: ConflictResolvedListener): () => void {
    this.conflictResolvedListeners.add(callback);
    return () => {
      this.conflictResolvedListeners.delete(callback);
    };
  }

  private emitConflictResolved(noteId: string, strategy: ConflictStrategy) {
    this.conflictResolvedListeners.forEach(cb => {
      try {
        cb(noteId, strategy);
      } catch (err) {
        console.warn('[MobileSyncManager] Conflict listener error:', err);
      }
    });
  }

  public hasConflict(noteId: string): boolean {
    return Boolean(noteId && this.conflictsMap.has(noteId));
  }

  public getConflict(noteId: string): ConflictEntry | undefined {
    return noteId ? this.conflictsMap.get(noteId) : undefined;
  }

  public getSnapshot(): SyncStateSnapshot {
    return {
      status: this.status,
      isOnline: this.isOnline,
      queuedCount: this.queuedCount,
      lastSyncedAt: this.lastSyncedAt,
      lastConflictNote: this.lastConflictNote,
      conflicts: Array.from(this.conflictsMap.values()),
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
      if (!this.isOnline) {
        this.status = 'offline';
        this.notify();
      } else if (this.conflictsMap.size > 0) {
        this.status = 'conflict';
        this.notify();
      } else if (this.isFlushing) {
        this.notify();
      } else if (this.queuedCount > 0) {
        this.status = 'pending';
        this.notify();
      } else {
        this.status = 'synced';
        this.notify();
      }
    } catch {
      this.queuedCount = 0;
    }
  }

  private async persistConflicts() {
    await saveConflicts(Array.from(this.conflictsMap.values()));
    this.lastConflictNote =
      this.conflictsMap.size > 0
        ? Array.from(this.conflictsMap.values())[this.conflictsMap.size - 1].serverNote
        : null;
  }

  private async recordConflict(
    noteId: string,
    localDraft: { title: string; content: string; isEncrypted?: boolean; encryptedData?: string | null },
    serverNotePayload?: any
  ): Promise<ConflictEntry> {
    let serverNote = serverNotePayload;
    if (!serverNote) {
      try {
        const remoteRes = await getNoteDetail(noteId);
        serverNote = remoteRes?.data;
      } catch {}
    }

    const entry: ConflictEntry = {
      noteId,
      title: localDraft.title || serverNote?.title || '未命名笔记',
      localDraft: {
        title: localDraft.title,
        content: localDraft.isEncrypted ? '' : (localDraft.content || ''),
        isEncrypted: Boolean(localDraft.isEncrypted),
        encryptedData: localDraft.encryptedData ?? null,
        updatedAt: new Date().toISOString(),
      },
      serverNote: serverNote || null,
      isEncrypted: Boolean(localDraft.isEncrypted || serverNote?.isEncrypted),
      detectedAt: new Date().toISOString(),
    };

    this.conflictsMap.set(noteId, entry);
    await this.persistConflicts();
    return entry;
  }

  /**
   * 离线变更入队辅助（供收藏/移动/删除失败后兜底排队）
   */
  public async queueOfflineAction(
    noteId: string,
    action: OfflineMutationAction,
    payload: OfflineMutation['payload'] = {}
  ) {
    if (!noteId) return;
    await enqueueMutation({ noteId, action, payload });
    await this.refreshQueuedCount();
  }

  /**
   * 按键输入实时落盘本地 AsyncStorage (0 延迟即时落盘，保留 remoteUpdatedAt 基准)
   */
  public async notifyLocalDirty(
    noteId: string,
    {
      title,
      content,
      baseUpdatedAt,
      expectedVersion,
      notebookId,
      parentId,
      isEncrypted,
      encryptedData,
    }: {
      title: string;
      content: string;
      baseUpdatedAt?: string | null;
      expectedVersion?: number;
      notebookId?: string;
      parentId?: string | null;
      isEncrypted?: boolean;
      encryptedData?: string | null;
    }
  ) {
    if (!noteId) return;
    const resolvedId = await resolveNoteId(noteId);
    const safeContent = isEncrypted ? '' : content;

    // 1. 立即持久化到本地 AsyncStorage（仅局部更新脏数据字段，不覆盖 remoteUpdatedAt 与 contentVersion）
    await saveNoteCache({
      id: resolvedId,
      title,
      content: safeContent,
      notebookId,
      parentId,
      isEncrypted: Boolean(isEncrypted),
      encryptedData: encryptedData ?? null,
      updatedAt: new Date().toISOString(),
      isDirty: true,
    });

    // 立即增量更新移动端离线检索倒排索引（私密笔记跳过明文索引）
    if (!isEncrypted) {
      mobileSearchEngine.upsertDocument({
        id: resolvedId,
        title,
        snippet: content,
        notebookId,
        updatedAt: new Date().toISOString(),
      });
    }

    // 2. 状态迁移
    if (!this.isOnline) {
      await enqueueMutation({
        noteId: resolvedId,
        action: 'update',
        payload: {
          title,
          content: safeContent,
          notebookId,
          parentId,
          isEncrypted: Boolean(isEncrypted),
          encryptedData: encryptedData ?? null,
        },
        baseUpdatedAt,
        expectedVersion: expectedVersion ?? this.lastKnownVersionMap.get(resolvedId),
      });
      await this.refreshQueuedCount();
      this.setStatus('offline');
    } else if (this.conflictsMap.size > 0) {
      this.setStatus('conflict');
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
      expectedVersion?: number;
      notebookId?: string;
      parentId?: string | null;
      isEncrypted?: boolean;
      encryptedData?: string | null;
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
      if (res?.success && !res.forked && !res.conflict && typeof noteData?.onSyncSuccess === 'function') {
        noteData.onSyncSuccess(res);
      }
    }, delay);

    this.debounceTimers.set(noteId, timer);
  }

  /**
   * 核心保存同步逻辑（基于 expectedVersion 乐观锁 + 409 非破坏性暂存冲突）
   */
  public async syncNote(
    noteId: string,
    {
      title,
      content,
      baseUpdatedAt,
      expectedVersion,
      notebookId,
      parentId,
      isEncrypted,
      encryptedData,
      force,
      saveType,
    }: {
      title: string;
      content: string;
      baseUpdatedAt?: string | null;
      expectedVersion?: number;
      notebookId?: string;
      parentId?: string | null;
      isEncrypted?: boolean;
      encryptedData?: string | null;
      force?: boolean;
      saveType?: 'manual' | 'auto' | 'rollback' | 'conflict';
    },
    options: { auto?: boolean; silent?: boolean } = {}
  ): Promise<{
    success: boolean;
    localOnly?: boolean;
    offline?: boolean;
    conflict?: boolean;
    conflictEntry?: ConflictEntry;
    forked?: boolean;
    forkedNote?: any;
    updatedAt?: string;
    contentVersion?: number;
    resolvedId?: string;
    error?: any;
  }> {
    if (!noteId) return { success: false, error: 'Note ID required' };

    if (this.debounceTimers.has(noteId)) {
      clearTimeout(this.debounceTimers.get(noteId));
      this.debounceTimers.delete(noteId);
    }

    const resolvedId = await resolveNoteId(noteId);
    const safeContent = isEncrypted ? '' : content;

    // 无论在线与否，先行稳固持久化到本地（保留既有 remoteUpdatedAt / contentVersion）
    await saveNoteCache({
      id: resolvedId,
      title,
      content: safeContent,
      notebookId,
      parentId,
      isEncrypted: Boolean(isEncrypted),
      encryptedData: encryptedData ?? null,
      updatedAt: new Date().toISOString(),
      isDirty: true,
    });

    // 立即增量更新移动端离线检索倒排索引（私密笔记跳过明文索引）
    if (!isEncrypted) {
      mobileSearchEngine.upsertDocument({
        id: resolvedId,
        title,
        snippet: content,
        notebookId,
        updatedAt: new Date().toISOString(),
      });
    }

    // 若已存在未裁决的冲突且未强制覆盖，拒绝静默推送覆盖，保留本地草稿等待用户裁决
    if (!force && this.conflictsMap.has(resolvedId)) {
      this.setStatus('conflict');
      return {
        success: false,
        conflict: true,
        conflictEntry: this.conflictsMap.get(resolvedId),
        resolvedId,
      };
    }

    // 1. 离线状态保底入队
    if (!this.isOnline) {
      const cached = await getNoteCache(resolvedId);
      const effectiveVersion =
        expectedVersion ?? this.lastKnownVersionMap.get(resolvedId) ?? cached?.contentVersion;
      await enqueueMutation({
        noteId: resolvedId,
        action: 'update',
        payload: {
          title,
          content: safeContent,
          notebookId,
          parentId,
          isEncrypted: Boolean(isEncrypted),
          encryptedData: encryptedData ?? null,
        },
        baseUpdatedAt,
        expectedVersion: effectiveVersion,
      });
      await this.refreshQueuedCount();
      this.setStatus('offline');
      return { success: true, localOnly: true, offline: true, resolvedId };
    }

    // 若仍是离线临时 ID，直接执行幂等 create 上云并映射真实 ID（避免重入 flushQueue 死锁）
    if (resolvedId.startsWith('local_')) {
      try {
        const promoted = await this.promoteLocalNoteCreate(
          resolvedId,
          {
            title,
            content: safeContent,
            notebookId,
            parentId,
            isEncrypted: Boolean(isEncrypted),
            encryptedData: encryptedData ?? null,
          },
          resolvedId
        );
        if (promoted.success && promoted.realId) {
          await clearMutationsForNote(resolvedId);
          await clearMutationsForNote(promoted.realId);
          await this.refreshQueuedCount();
          return {
            success: true,
            localOnly: false,
            resolvedId: promoted.realId,
            updatedAt: promoted.realNote?.updatedAt,
            contentVersion: promoted.realNote?.contentVersion,
          };
        }
        await enqueueMutation({
          noteId: resolvedId,
          action: 'update',
          payload: {
            title,
            content: safeContent,
            notebookId,
            parentId,
            isEncrypted: Boolean(isEncrypted),
            encryptedData: encryptedData ?? null,
          },
          baseUpdatedAt,
        });
        await this.refreshQueuedCount();
        return { success: false, localOnly: true, resolvedId };
      } catch (promoteErr: any) {
        const st: number | undefined = promoteErr?.status ?? promoteErr?.response?.status;
        if (!st) {
          this.isOnline = false;
        }
        await enqueueMutation({
          noteId: resolvedId,
          action: 'update',
          payload: {
            title,
            content: safeContent,
            notebookId,
            parentId,
            isEncrypted: Boolean(isEncrypted),
            encryptedData: encryptedData ?? null,
          },
          baseUpdatedAt,
        });
        await this.refreshQueuedCount();
        return {
          success: false,
          localOnly: true,
          offline: !this.isOnline,
          resolvedId,
          error: promoteErr,
        };
      }
    }

    // 2. 在线状态推送（携带 expectedVersion 乐观锁给服务端原子判冲）
    this.setStatus('syncing');

    let effectiveVersion = expectedVersion ?? this.lastKnownVersionMap.get(resolvedId);
    if (effectiveVersion === undefined) {
      const cached = await getNoteCache(resolvedId);
      effectiveVersion = cached?.contentVersion;
    }

    try {
      const savePayload: {
        title?: string;
        content?: string;
        isEncrypted?: boolean;
        encryptedData?: string | null;
        expectedVersion?: number;
        force?: boolean;
        saveType?: 'manual' | 'auto' | 'rollback' | 'conflict';
      } = {
        title,
        content: safeContent,
      };
      if (isEncrypted !== undefined) savePayload.isEncrypted = isEncrypted;
      if (encryptedData !== undefined) savePayload.encryptedData = encryptedData;
      if (typeof effectiveVersion === 'number' && !force) {
        savePayload.expectedVersion = effectiveVersion;
      }
      if (force) savePayload.force = true;
      if (saveType) {
        savePayload.saveType = saveType;
      } else if (options.auto) {
        savePayload.saveType = 'auto';
      }

      const saveRes = await updateNote(resolvedId, savePayload);
      const savedNote = saveRes?.data;
      const savedUpdatedAt = savedNote?.updatedAt || new Date().toISOString();
      const savedVersion = savedNote?.contentVersion;

      this.lastKnownRemoteUpdatedAt.set(resolvedId, savedUpdatedAt);
      this.lastSavedContentMap.set(resolvedId, safeContent);
      if (typeof savedVersion === 'number') {
        this.lastKnownVersionMap.set(resolvedId, savedVersion);
      }

      await saveNoteCache({
        id: resolvedId,
        title,
        content: safeContent,
        notebookId: savedNote?.notebookId ?? notebookId,
        parentId: savedNote?.parentId !== undefined ? savedNote.parentId : parentId,
        isEncrypted: Boolean(isEncrypted),
        encryptedData: encryptedData ?? null,
        contentVersion: savedVersion,
        remoteUpdatedAt: savedUpdatedAt,
        updatedAt: savedUpdatedAt,
        lastSavedContent: safeContent,
        lastSyncedAt: new Date().toISOString(),
        isDirty: false,
      });

      if (this.conflictsMap.has(resolvedId)) {
        this.conflictsMap.delete(resolvedId);
        await this.persistConflicts();
      }

      await clearMutationsForNote(resolvedId);
      await this.refreshQueuedCount();

      this.isOnline = true;
      this.lastSyncedAt = new Date();
      this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'synced');
      return {
        success: true,
        localOnly: false,
        resolvedId,
        updatedAt: savedUpdatedAt,
        contentVersion: savedVersion,
      };
    } catch (error: any) {
      const httpStatus: number | undefined = error?.status ?? error?.response?.status;

      // 服务端乐观锁命中 409 冲突：绝不覆盖本地脏草稿，绝不静默克隆副本，保留双方版本供交互裁决
      if (httpStatus === 409) {
        const serverNote =
          error?.data?.data?.serverNote || error?.data?.serverNote || error?.response?.data?.data?.serverNote;
        const conflictEntry = await this.recordConflict(
          resolvedId,
          { title, content, isEncrypted, encryptedData },
          serverNote
        );
        await clearMutationsForNote(resolvedId);
        this.isOnline = true;
        await this.refreshQueuedCount();
        this.setStatus('conflict');
        return {
          success: false,
          conflict: true,
          conflictEntry,
          resolvedId,
          error,
        };
      }

      // 服务端明确返回 4xx 客户端错误时，网络处于在线状态，勿误判为 offline
      if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
        this.isOnline = true;
        this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'synced');
        return { success: false, resolvedId, error };
      }

      console.warn('[MobileSyncManager] Cloud save failed, enqueueing mutation:', error);

      if (!httpStatus) {
        this.isOnline = false;
      }
      await enqueueMutation({
        noteId: resolvedId,
        action: 'update',
        payload: {
          title,
          content: safeContent,
          notebookId,
          parentId,
          isEncrypted: Boolean(isEncrypted),
          encryptedData: encryptedData ?? null,
        },
        baseUpdatedAt,
        expectedVersion: effectiveVersion,
      });
      await this.refreshQueuedCount();

      this.setStatus(!this.isOnline ? 'offline' : 'pending');
      return { success: false, localOnly: true, offline: !this.isOnline, resolvedId, error };
    }
  }

  /**
   * 获取或自动创建专用的「冲突归档」系统笔记本，杜绝污染正常工作目录（兼容检索历史别名）
   */
  public async getConflictNotebookId(): Promise<string> {
    try {
      const res = await getNotebooks();
      const list = res?.data || [];
      const existing =
        list.find((nb: any) => (nb.name || nb.title) === '冲突归档') ||
        list.find((nb: any) => (nb.name || nb.title) === '⚠️ 冲突归档');
      if (existing) {
        return existing._id || '';
      }
      const createRes = await createNotebook({
        title: '冲突归档',
        name: '冲突归档',
      });
      const newNb = createRes?.data;
      return (newNb as any)?._id || (newNb as any)?.id || '';
    } catch (e) {
      console.warn('[mobileSyncManager] getConflictNotebookId warning:', e);
      return '';
    }
  }

  /**
   * 非破坏性冲突副本另存（支持私密密文直存，归集入「冲突归档」专区）
   */
  public async forkConflictNote({
    originalTitle,
    content,
    notebookId,
    isEncrypted,
    encryptedData,
  }: {
    originalTitle: string;
    content: string;
    notebookId: string;
    isEncrypted?: boolean;
    encryptedData?: string | null;
  }) {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const conflictTitle = `[冲突副本] ${originalTitle || '无标题'}_${timeStamp}`;

    // 隔离专区策略：冲突副本绝不进入原工作目录，优先归集入「⚠️ 冲突归档」笔记本
    let targetNotebookId = await this.getConflictNotebookId();
    if (!targetNotebookId) {
      targetNotebookId = notebookId || '';
    }

    const safeContent = isEncrypted ? '' : content;
    const createRes = await createNote({
      title: conflictTitle,
      content: safeContent,
      notebookId: targetNotebookId,
      isEncrypted: Boolean(isEncrypted),
      encryptedData: isEncrypted ? (encryptedData ?? null) : null,
      clientId: `conflict_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    });

    const createdNote = createRes?.data;
    const noteId = (createdNote as any)?._id || (createdNote as any)?.id;
    if (createdNote && noteId) {
      await saveNoteCache({
        id: noteId,
        title: createdNote.title,
        content: isEncrypted ? '' : createdNote.content,
        notebookId: createdNote.notebookId,
        isEncrypted: Boolean(createdNote.isEncrypted),
        encryptedData: createdNote.encryptedData ?? null,
        contentVersion: createdNote.contentVersion,
        remoteUpdatedAt: createdNote.updatedAt,
        updatedAt: createdNote.updatedAt,
        lastSavedContent: isEncrypted ? '' : createdNote.content,
        lastSyncedAt: new Date().toISOString(),
        isDirty: false,
      });
    }

    return createdNote;
  }

  /**
   * 交互式冲突裁决：保留本地覆盖 / 采用云端版本 / 另存冲突副本
   */
  public async resolveConflict(
    noteId: string,
    strategy: ConflictStrategy,
    resolvedPayload?: {
      title?: string;
      content?: string;
      isEncrypted?: boolean;
      encryptedData?: string | null;
    }
  ): Promise<{ success: boolean; forkedNote?: any; resolvedNote?: any; error?: any }> {
    const resolvedId = await resolveNoteId(noteId);
    const conflict = this.conflictsMap.get(resolvedId);
    const cached = await getNoteCache(resolvedId);

    if (strategy === 'keep_local') {
      const localTitle =
        resolvedPayload?.title ?? conflict?.localDraft?.title ?? cached?.title ?? '无标题笔记';
      const isEncrypted =
        resolvedPayload?.isEncrypted ?? conflict?.localDraft?.isEncrypted ?? cached?.isEncrypted ?? false;
      const encryptedData =
        resolvedPayload?.encryptedData !== undefined
          ? resolvedPayload.encryptedData
          : (conflict?.localDraft?.encryptedData ?? cached?.encryptedData ?? null);
      const localContent = isEncrypted
        ? ''
        : (resolvedPayload?.content ?? conflict?.localDraft?.content ?? cached?.content ?? '');

      const res = await this.syncNote(
        resolvedId,
        {
          title: localTitle,
          content: localContent,
          notebookId: conflict?.serverNote?.notebookId ?? cached?.notebookId,
          parentId: conflict?.serverNote?.parentId ?? cached?.parentId,
          isEncrypted,
          encryptedData,
          force: true,
          saveType: 'conflict',
        },
        { silent: false }
      );

      if (!res.success) {
        return { success: false, error: res.error || '强制覆盖云端失败' };
      }

      this.conflictsMap.delete(resolvedId);
      await this.persistConflicts();
      await this.refreshQueuedCount();
      this.emitConflictResolved(resolvedId, strategy);
      return { success: true };
    }

    // 采用云端版本 / 另存冲突副本后回落到云端基准
    let serverNote = conflict?.serverNote;
    if (!serverNote) {
      try {
        const remoteRes = await getNoteDetail(resolvedId);
        serverNote = remoteRes?.data;
      } catch (err) {
        return { success: false, error: err };
      }
    }

    let forkedNote: any = null;
    if (strategy === 'fork_copy') {
      const localTitle =
        resolvedPayload?.title ?? conflict?.localDraft?.title ?? cached?.title ?? serverNote?.title ?? '无标题';
      const isEncrypted =
        resolvedPayload?.isEncrypted ?? conflict?.localDraft?.isEncrypted ?? cached?.isEncrypted ?? false;
      const encryptedData =
        resolvedPayload?.encryptedData !== undefined
          ? resolvedPayload.encryptedData
          : (conflict?.localDraft?.encryptedData ?? cached?.encryptedData ?? null);
      const localContent = isEncrypted
        ? ''
        : (resolvedPayload?.content ?? conflict?.localDraft?.content ?? cached?.content ?? '');

      try {
        forkedNote = await this.forkConflictNote({
          originalTitle: localTitle,
          content: localContent,
          notebookId: serverNote?.notebookId || cached?.notebookId || '',
          isEncrypted,
          encryptedData,
        });
      } catch (err) {
        return { success: false, error: err };
      }
    }

    const serverIsEncrypted = Boolean(serverNote?.isEncrypted);
    const serverContent = serverIsEncrypted ? '' : (serverNote?.content || '');
    const serverUpdatedAt = serverNote?.updatedAt || new Date().toISOString();

    await clearMutationsForNote(resolvedId);
    await saveNoteCache({
      id: resolvedId,
      title: serverNote?.title || cached?.title || '无标题笔记',
      content: serverContent,
      notebookId: serverNote?.notebookId ?? cached?.notebookId,
      parentId: serverNote?.parentId !== undefined ? serverNote.parentId : cached?.parentId,
      isEncrypted: serverIsEncrypted,
      encryptedData: serverIsEncrypted ? (serverNote?.encryptedData ?? null) : null,
      contentVersion: serverNote?.contentVersion,
      remoteUpdatedAt: serverUpdatedAt,
      updatedAt: serverUpdatedAt,
      lastSavedContent: serverContent,
      lastSyncedAt: new Date().toISOString(),
      isDirty: false,
    });

    this.lastKnownRemoteUpdatedAt.set(resolvedId, serverUpdatedAt);
    this.lastSavedContentMap.set(resolvedId, serverContent);
    if (typeof serverNote?.contentVersion === 'number') {
      this.lastKnownVersionMap.set(resolvedId, serverNote.contentVersion);
    }

    if (!serverIsEncrypted) {
      mobileSearchEngine.upsertDocument({
        id: resolvedId,
        title: serverNote?.title || '无标题笔记',
        snippet: serverContent,
        notebookId: serverNote?.notebookId,
        updatedAt: serverUpdatedAt,
      });
    } else {
      mobileSearchEngine.removeDocument(resolvedId);
    }

    this.conflictsMap.delete(resolvedId);
    await this.persistConflicts();
    await this.refreshQueuedCount();
    this.emitConflictResolved(resolvedId, strategy);
    return { success: true, forkedNote, resolvedNote: serverNote };
  }

  /**
   * 离线新建笔记分配本地临时 ID 并入队
   */
  public async createOfflineNote({
    title,
    content,
    notebookId,
    parentId,
    isEncrypted,
    encryptedData,
  }: {
    title: string;
    content: string;
    notebookId?: string;
    parentId?: string | null;
    isEncrypted?: boolean;
    encryptedData?: string | null;
  }) {
    const noteCache = await createOfflineNote({
      title,
      content,
      notebookId,
      parentId,
      isEncrypted,
      encryptedData,
    });
    if (!isEncrypted) {
      mobileSearchEngine.upsertDocument({
        id: noteCache.id,
        title: noteCache.title,
        snippet: noteCache.content,
        notebookId,
        updatedAt: noteCache.updatedAt,
      });
    }
    await this.refreshQueuedCount();
    if (!this.isOnline) {
      this.setStatus('offline');
    } else {
      this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'pending');
      void this.flushQueue();
    }
    return noteCache;
  }

  /**
   * 将本地临时 local_ 笔记通过幂等 clientId 提升为远端正式文档，并同步重映射本地缓存与索引
   */
  private async promoteLocalNoteCreate(
    tempId: string,
    payload: OfflineMutation['payload'],
    clientId?: string
  ): Promise<{ success: boolean; realId?: string; realNote?: any }> {
    const cached = await getNoteCache(tempId);
    let targetNbId = payload.notebookId ?? cached?.notebookId;
    if (!targetNbId) {
      const nbRes = await getNotebooks();
      if (nbRes.code === 200 && nbRes.data.length > 0) {
        targetNbId = nbRes.data[0]._id;
      }
    }

    const effectiveEncrypted =
      payload.isEncrypted !== undefined ? Boolean(payload.isEncrypted) : Boolean(cached?.isEncrypted);
    const effectiveEncryptedData =
      payload.encryptedData !== undefined ? payload.encryptedData : (cached?.encryptedData ?? null);
    const effectiveContent = effectiveEncrypted ? '' : (payload.content ?? cached?.content ?? '');

    const createRes = await createNote({
      title: payload.title || cached?.title || '无标题笔记',
      content: effectiveContent,
      notebookId: targetNbId || '',
      parentId: payload.parentId !== undefined ? payload.parentId : (cached?.parentId ?? null),
      isEncrypted: effectiveEncrypted,
      encryptedData: effectiveEncryptedData,
      clientId: clientId || tempId,
    });

    if (createRes?.code !== 200 || !createRes.data) {
      return { success: false };
    }

    const realNote = createRes.data;
    const realId = (realNote as any)._id || (realNote as any).id;

    await remapLocalNoteId(tempId, {
      id: realId,
      title: realNote.title,
      content: realNote.content,
      updatedAt: realNote.updatedAt,
      notebookId: realNote.notebookId,
      parentId: realNote.parentId,
      isEncrypted: realNote.isEncrypted,
      encryptedData: realNote.encryptedData,
      contentVersion: realNote.contentVersion,
    });

    this.setLastKnownRemoteUpdatedAt(
      realId,
      realNote.updatedAt,
      realNote.isEncrypted ? '' : realNote.content,
      realNote.contentVersion
    );

    mobileSearchEngine.removeDocument(tempId);
    if (!realNote.isEncrypted) {
      mobileSearchEngine.upsertDocument({
        id: realId,
        title: realNote.title,
        snippet: realNote.content,
        notebookId: realNote.notebookId,
        updatedAt: realNote.updatedAt,
      });
    }

    return { success: true, realId, realNote };
  }

  /**
   * 恢复联网后排空与重放突变队列（支持多任务按序重映射与单笔记隔离防阻塞）
   */
  public async flushQueue() {
    if (this.isFlushing || !this.isOnline) return;
    this.isFlushing = true;

    try {
      const mutations = await getPendingMutations();
      if (mutations.length === 0) {
        await this.refreshQueuedCount();
        this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'synced');
        return;
      }

      this.setStatus('syncing');

      for (let i = 0; i < mutations.length; i++) {
        const task = mutations[i];
        const currentNoteId = await resolveNoteId(task.noteId);
        const { action, payload, baseUpdatedAt, seq } = task;

        try {
          // create 任务以及前置 create 失败后遗留的 local_ update 任务统一走幂等建档重映射路径
          if (action === 'create' || (action === 'update' && currentNoteId.startsWith('local_'))) {
            const promoted = await this.promoteLocalNoteCreate(
              currentNoteId,
              payload,
              task.clientId || currentNoteId
            );

            if (promoted.success && promoted.realId) {
              const realId = promoted.realId;
              // 立即同步更新内存中后续待重放任务的 noteId，避免后续 update/star/move 误打到 local_
              for (let j = i + 1; j < mutations.length; j++) {
                if (mutations[j].noteId === task.noteId || mutations[j].noteId === currentNoteId) {
                  mutations[j].noteId = realId;
                }
              }
              await dequeueMutation(seq);
            } else {
              const retries = await incrementMutationRetry(seq);
              if (retries >= 3) {
                await dequeueMutation(seq);
                continue;
              }
              break;
            }
          } else if (action === 'delete') {
            if (currentNoteId.startsWith('local_')) {
              await deleteNoteCache(currentNoteId);
              mobileSearchEngine.removeDocument(currentNoteId);
              await dequeueMutation(seq);
              continue;
            }
            await deleteNote(currentNoteId);
            await deleteNoteCache(currentNoteId);
            mobileSearchEngine.removeDocument(currentNoteId);
            await dequeueMutation(seq);
          } else if (action === 'star') {
            if (currentNoteId.startsWith('local_')) {
              const retries = await incrementMutationRetry(seq);
              if (retries >= 3) await dequeueMutation(seq);
              continue;
            }
            await updateNoteStarred(currentNoteId, Boolean(payload.isStarred));
            await dequeueMutation(seq);
          } else if (action === 'move') {
            if (currentNoteId.startsWith('local_')) {
              const retries = await incrementMutationRetry(seq);
              if (retries >= 3) await dequeueMutation(seq);
              continue;
            }
            await moveNote(currentNoteId, {
              targetParentId: payload.targetParentId,
              notebookId: payload.notebookId,
            });
            await dequeueMutation(seq);
          } else {
            // 若该笔记当前处于待裁决冲突状态，隔离跳过以免阻塞队列中其余笔记的同步
            if (this.conflictsMap.has(currentNoteId)) {
              await dequeueMutation(seq);
              continue;
            }

            const res = await this.syncNote(
              currentNoteId,
              {
                title: payload.title || '',
                content: payload.content || '',
                baseUpdatedAt,
                expectedVersion:
                  task.expectedVersion ?? this.lastKnownVersionMap.get(currentNoteId),
                notebookId: payload.notebookId,
                parentId: payload.parentId,
                isEncrypted: payload.isEncrypted,
                encryptedData: payload.encryptedData,
              },
              { auto: true }
            );

            if (res.success && !res.offline) {
              await dequeueMutation(seq);
            } else if (res.conflict) {
              await dequeueMutation(seq);
              continue;
            } else if (!res.offline) {
              const errStatus = res.error?.status;
              const retries = await incrementMutationRetry(seq);
              if ((errStatus && errStatus >= 400 && errStatus < 500) || retries >= 3) {
                await dequeueMutation(seq);
                continue;
              }
              break;
            } else {
              await incrementMutationRetry(seq);
              break;
            }
          }
        } catch (taskErr: any) {
          const errStatus: number | undefined = taskErr?.status ?? taskErr?.response?.status;
          if (errStatus === 404) {
            await dequeueMutation(seq);
            continue;
          }
          if (errStatus && errStatus >= 400 && errStatus < 500) {
            if (errStatus === 401) break;
            const retries = await incrementMutationRetry(seq);
            if (errStatus === 400 || errStatus === 403 || errStatus === 422 || retries >= 3) {
              await dequeueMutation(seq);
              continue;
            }
          }
          if (!errStatus) {
            this.isOnline = false;
          }
          await incrementMutationRetry(seq);
          break;
        }
      }

      await this.refreshQueuedCount();
      if (this.queuedCount === 0 && this.isOnline) {
        this.lastSyncedAt = new Date();
        this.setStatus(this.conflictsMap.size > 0 ? 'conflict' : 'synced');
      } else if (!this.isOnline) {
        this.setStatus('offline');
      } else if (this.conflictsMap.size > 0) {
        this.setStatus('conflict');
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * 手动触发立即重试同步
   */
  public async retryManual() {
    await this.probeNetwork();
    await this.flushQueue();
  }
}

export const mobileSyncManager = new MobileSyncManager();
export default mobileSyncManager;
