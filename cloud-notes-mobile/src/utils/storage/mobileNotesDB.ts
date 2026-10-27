/**
 * mobileNotesDB.ts - 移动端 Local-First 本地持久化访问层 (DAO)
 * 基于 @react-native-async-storage/async-storage 封装，与 PC 端 IndexedDB 保持 100% 结构同构
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NoteCache {
  id: string;
  title: string;
  content: string;
  isEncrypted?: boolean;
  encryptedData?: string | null;
  updatedAt: string;
  lastSavedContent: string;
  lastSyncedAt: string;
  isDirty: boolean;
}

export interface OfflineMutation {
  seq: number;
  noteId: string;
  action: 'update' | 'create';
  payload: {
    title?: string;
    content?: string;
    notebookId?: string;
    isEncrypted?: boolean;
    encryptedData?: string | null;
  };
  baseUpdatedAt?: string | null;
  timestamp: number;
  retryCount: number;
}

const CACHE_KEY_PREFIX = '@cloud_notes:cache:';
const ALIAS_KEY_PREFIX = '@cloud_notes:alias:';
const MUTATIONS_KEY = '@cloud_notes:mutations';

// ==================== 1. 本地笔记快照缓存 API ====================

/**
 * 解析本地临时 ID 别名映射为远端真实 ID
 */
export async function resolveNoteId(id: string): Promise<string> {
  if (!id || !id.startsWith('local_')) return id;
  try {
    const realId = await AsyncStorage.getItem(`${ALIAS_KEY_PREFIX}${id}`);
    return realId || id;
  } catch {
    return id;
  }
}

/**
 * 获取本地缓存的笔记数据
 */
export async function getNoteCache(id: string): Promise<NoteCache | null> {
  if (!id) return null;
  try {
    let targetId = id;
    if (id.startsWith('local_')) {
      const alias = await AsyncStorage.getItem(`${ALIAS_KEY_PREFIX}${id}`);
      if (alias) {
        targetId = alias;
      }
    }
    const raw = await AsyncStorage.getItem(`${CACHE_KEY_PREFIX}${targetId}`);
    if (!raw) return null;
    return JSON.parse(raw) as NoteCache;
  } catch (e) {
    console.warn('[mobileNotesDB] getNoteCache error:', e);
    return null;
  }
}

/**
 * 保存/更新单篇笔记的本地快照
 */
export async function saveNoteCache(noteCache: Partial<NoteCache> & { id: string }): Promise<void> {
  if (!noteCache || !noteCache.id) return;
  try {
    const record: NoteCache = {
      id: noteCache.id,
      title: noteCache.title || '',
      content: noteCache.content !== undefined ? noteCache.content : '',
      updatedAt: noteCache.updatedAt || new Date().toISOString(),
      lastSavedContent:
        noteCache.lastSavedContent !== undefined
          ? noteCache.lastSavedContent
          : noteCache.content || '',
      lastSyncedAt: noteCache.lastSyncedAt || new Date().toISOString(),
      isDirty: Boolean(noteCache.isDirty),
    };

    await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${noteCache.id}`, JSON.stringify(record));
  } catch (e) {
    console.warn('[mobileNotesDB] saveNoteCache error:', e);
  }
}

/**
 * 删除本地笔记快照
 */
export async function deleteNoteCache(id: string): Promise<void> {
  if (!id) return;
  try {
    await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}${id}`);
  } catch (e) {
    console.warn('[mobileNotesDB] deleteNoteCache error:', e);
  }
}

/**
 * 获取本地缓存的所有笔记快照列表（按更新时间降序）
 */
export async function getAllCachedNotes(): Promise<NoteCache[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const noteKeys = allKeys.filter(k => k.startsWith(CACHE_KEY_PREFIX));
    if (noteKeys.length === 0) return [];

    const pairs = await AsyncStorage.multiGet(noteKeys);
    const notes: NoteCache[] = [];
    for (const [, val] of pairs) {
      if (val) {
        notes.push(JSON.parse(val));
      }
    }
    notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return notes;
  } catch (e) {
    console.warn('[mobileNotesDB] getAllCachedNotes error:', e);
    return [];
  }
}

/**
 * 离线新建笔记分配本地临时 ID
 */
export async function createOfflineNote({
  title,
  content,
  notebookId,
}: {
  title: string;
  content: string;
  notebookId?: string;
}): Promise<NoteCache> {
  const tempId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const record: NoteCache = {
    id: tempId,
    title: title || '无标题笔记',
    content: content || '',
    updatedAt: now,
    lastSavedContent: content || '',
    lastSyncedAt: now,
    isDirty: true,
  };

  await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${tempId}`, JSON.stringify(record));
  await enqueueMutation({
    noteId: tempId,
    action: 'create',
    payload: { title, content, notebookId },
  });

  return record;
}

/**
 * 远端创建成功后，将本地临时 ID 原子映射替换为远端真实 ID
 */
export async function remapLocalNoteId(
  tempId: string,
  realNote: { id: string; title: string; content: string; updatedAt: string; notebookId?: string }
): Promise<void> {
  if (!tempId || !realNote?.id || tempId === realNote.id) return;
  try {
    const record: NoteCache = {
      id: realNote.id,
      title: realNote.title,
      content: realNote.content,
      updatedAt: realNote.updatedAt,
      lastSavedContent: realNote.content,
      lastSyncedAt: new Date().toISOString(),
      isDirty: false,
    };

    await AsyncStorage.setItem(`${CACHE_KEY_PREFIX}${realNote.id}`, JSON.stringify(record));
    await AsyncStorage.removeItem(`${CACHE_KEY_PREFIX}${tempId}`);
    await AsyncStorage.setItem(`${ALIAS_KEY_PREFIX}${tempId}`, realNote.id);

    // 重映射突变队列中残留关联
    const list = await getPendingMutations();
    let hasChanged = false;
    list.forEach(item => {
      if (item.noteId === tempId) {
        item.noteId = realNote.id;
        hasChanged = true;
      }
    });
    if (hasChanged) {
      await AsyncStorage.setItem(MUTATIONS_KEY, JSON.stringify(list));
    }
  } catch (e) {
    console.warn('[mobileNotesDB] remapLocalNoteId error:', e);
  }
}

// ==================== 2. 离线突变队列 (Offline Mutations) API ====================

/**
 * 将离线突变任务压入队列（同 noteId 的 update 任务合并为最新）
 */
export async function enqueueMutation({
  noteId,
  action = 'update',
  payload = {},
  baseUpdatedAt = null,
}: {
  noteId: string;
  action?: 'update' | 'create';
  payload?: any;
  baseUpdatedAt?: string | null;
}): Promise<number> {
  if (!noteId) return -1;
  try {
    const list = await getPendingMutations();
    const existingIndex = list.findIndex(t => t.noteId === noteId && t.action === action);

    let targetSeq = Date.now();

    if (existingIndex !== -1 && action === 'update') {
      const existing = list[existingIndex];
      existing.payload = {
        ...existing.payload,
        ...payload,
      };
      existing.timestamp = Date.now();
      targetSeq = existing.seq;
    } else {
      const newTask: OfflineMutation = {
        seq: targetSeq,
        noteId,
        action,
        payload,
        baseUpdatedAt,
        timestamp: Date.now(),
        retryCount: 0,
      };
      list.push(newTask);
    }

    await AsyncStorage.setItem(MUTATIONS_KEY, JSON.stringify(list));
    return targetSeq;
  } catch (e) {
    console.warn('[mobileNotesDB] enqueueMutation error:', e);
    return -1;
  }
}

/**
 * 从队列中移除已处理成功的突变任务
 */
export async function dequeueMutation(seq: number): Promise<void> {
  if (!seq) return;
  try {
    const list = await getPendingMutations();
    const filtered = list.filter(t => t.seq !== seq);
    await AsyncStorage.setItem(MUTATIONS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[mobileNotesDB] dequeueMutation error:', e);
  }
}

/**
 * 获取所有排队中的待同步突变任务
 */
export async function getPendingMutations(): Promise<OfflineMutation[]> {
  try {
    const raw = await AsyncStorage.getItem(MUTATIONS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as OfflineMutation[];
    list.sort((a, b) => a.seq - b.seq);
    return list;
  } catch (e) {
    console.warn('[mobileNotesDB] getPendingMutations error:', e);
    return [];
  }
}

/**
 * 获取排队任务总数
 */
export async function getPendingMutationCount(): Promise<number> {
  try {
    const list = await getPendingMutations();
    return list.length;
  } catch {
    return 0;
  }
}

/**
 * 清除指定笔记的所有排队任务
 */
export async function clearMutationsForNote(noteId: string): Promise<void> {
  if (!noteId) return;
  try {
    const list = await getPendingMutations();
    const filtered = list.filter(t => t.noteId !== noteId);
    await AsyncStorage.setItem(MUTATIONS_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[mobileNotesDB] clearMutationsForNote error:', e);
  }
}

// ==================== 3. 全库离线检索轻量索引 (Search Index) API ====================

export interface SearchIndexDoc {
  id: string;
  title: string;
  snippet: string;
  notebookId: string;
  notebookName: string;
  notebookColor: string;
  updatedAt: string;
  createdAt?: string;
  isStarred?: boolean;
}

const SEARCH_INDEX_KEY = '@cloud_notes:search_index';

/**
 * 获取所有本地持久化的检索文档
 */
export async function getAllSearchIndexDocs(): Promise<SearchIndexDoc[]> {
  try {
    const raw = await AsyncStorage.getItem(SEARCH_INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SearchIndexDoc[];
  } catch (e) {
    console.warn('[mobileNotesDB] getAllSearchIndexDocs error:', e);
    return [];
  }
}

/**
 * 批量保存/覆盖离线检索文档
 */
export async function saveSearchIndexDocs(docs: SearchIndexDoc[] = []): Promise<void> {
  if (!Array.isArray(docs)) return;
  try {
    await AsyncStorage.setItem(SEARCH_INDEX_KEY, JSON.stringify(docs));
  } catch (e) {
    console.warn('[mobileNotesDB] saveSearchIndexDocs error:', e);
  }
}

/**
 * 增量新增或更新单篇笔记的检索条目
 */
export async function upsertSearchIndexDoc(doc: SearchIndexDoc): Promise<void> {
  if (!doc || !doc.id) return;
  try {
    const list = await getAllSearchIndexDocs();
    const index = list.findIndex(d => d.id === doc.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...doc };
    } else {
      list.unshift(doc);
    }
    await AsyncStorage.setItem(SEARCH_INDEX_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[mobileNotesDB] upsertSearchIndexDoc error:', e);
  }
}

/**
 * 删除单篇笔记的检索条目
 */
export async function deleteSearchIndexDoc(id: string): Promise<void> {
  if (!id) return;
  try {
    const list = await getAllSearchIndexDocs();
    const filtered = list.filter(d => d.id !== id);
    await AsyncStorage.setItem(SEARCH_INDEX_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.warn('[mobileNotesDB] deleteSearchIndexDoc error:', e);
  }
}

