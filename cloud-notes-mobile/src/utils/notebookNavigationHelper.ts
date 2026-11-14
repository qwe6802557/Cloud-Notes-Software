import { Notebook } from '../api/types';

export interface NotebookSelectionState {
  pendingNotebookId: string | null;
  selectionSeq: number;
}

const navState = {
  pendingNotebookId: null as string | null,
  selectionSeq: 0,
  notesDataVersion: 0,
  notebooksDataVersion: 0,
};

/**
 * 记录一次显式笔记本切换选择，确保从“笔记本”Tab 或面包屑跳转回笔记列表时必定绕过 SWR 缓存立即刷新
 */
export function markNotebookSelected(notebookId: string): {
  notebookId: string;
  selectionSeq: number;
} {
  navState.selectionSeq += 1;
  navState.pendingNotebookId = notebookId;
  return {
    notebookId,
    selectionSeq: navState.selectionSeq,
  };
}

export function getNotebookSelectionState(): NotebookSelectionState {
  return {
    pendingNotebookId: navState.pendingNotebookId,
    selectionSeq: navState.selectionSeq,
  };
}

/**
 * 标记笔记或目录数据发生变更（新建、编辑、移动、重命名、删除或同步完成），促使列表在下次聚焦时自动拉新
 */
export function markNotesDataDirty(): number {
  navState.notesDataVersion += 1;
  return navState.notesDataVersion;
}

export function getNotesDataVersion(): number {
  return navState.notesDataVersion;
}

export function markNotebooksDataDirty(): number {
  navState.notebooksDataVersion += 1;
  return navState.notebooksDataVersion;
}

export function getNotebooksDataVersion(): number {
  return navState.notebooksDataVersion;
}

/**
 * 测试与调试辅助：重置内存态导航协调计数
 */
export function resetNotebookNavigationState(): void {
  navState.pendingNotebookId = null;
  navState.selectionSeq = 0;
  navState.notesDataVersion = 0;
  navState.notebooksDataVersion = 0;
}

/**
 * 安全解包 Expo Router 路由参数（兼容 string | string[] | undefined）
 */
export function normalizeRouteParam(value: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 从字符串 ID 或已 populate 对象中安全提取字符串实体 ID
 */
export function extractEntityId(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'object' && '_id' in (raw as Record<string, unknown>)) {
    const nested = (raw as { _id?: unknown })._id;
    return typeof nested === 'string' && nested.trim() ? nested.trim() : null;
  }
  return null;
}

export interface ResolveTargetNotebookInput {
  overrideNbId?: string | null;
  routeNbId?: string | null;
  pendingSelectedNbId?: string | null;
  storedNbId?: string | null;
  previousNbId?: string | null;
  loadedNotebooks: Notebook[];
  notebooksFetchOk: boolean;
}

/**
 * 解析当前应加载的目标笔记本 ID：
 * 1) 当 /notebooks 请求正常返回时，校验目标 ID 是否仍存在于有效笔记本列表中，不存在则回退默认笔记本；
 * 2) 当 /notebooks 请求瞬时失败时，绝不清空已选定的 targetNbId，确保笔记列表仍能按目标笔记本拉取。
 */
export function resolveTargetNotebookId(input: ResolveTargetNotebookInput): string | null {
  const {
    overrideNbId,
    routeNbId,
    pendingSelectedNbId,
    storedNbId,
    previousNbId,
    loadedNotebooks,
    notebooksFetchOk,
  } = input;

  const candidate =
    (overrideNbId !== undefined ? overrideNbId : null) ||
    pendingSelectedNbId ||
    routeNbId ||
    storedNbId ||
    previousNbId ||
    null;

  if (!notebooksFetchOk || loadedNotebooks.length === 0) {
    return candidate;
  }

  if (candidate && loadedNotebooks.some(nb => nb._id === candidate)) {
    return candidate;
  }

  const defaultNb =
    loadedNotebooks.find(nb => (nb.title || nb.name) === '默认笔记本') ||
    loadedNotebooks[0];

  return defaultNb ? defaultNb._id : null;
}

export interface BypassThrottleInput {
  isRefresh: boolean;
  isFirstLoad: boolean;
  overrideNbId?: string | null;
  hasExplicitSelection: boolean;
  targetNbId: string | null;
  activeNbId: string | null;
  dataVersion: number;
  loadedDataVersion: number;
  now: number;
  lastFetchTime: number;
  staleMs?: number;
}

/**
 * 判断笔记列表在页面聚焦或交互时是否必须绕过 30 秒 SWR 冷却立刻向服务端拉取最新列表
 */
export function shouldBypassNotesThrottle(input: BypassThrottleInput): boolean {
  const {
    isRefresh,
    isFirstLoad,
    overrideNbId,
    hasExplicitSelection,
    targetNbId,
    activeNbId,
    dataVersion,
    loadedDataVersion,
    now,
    lastFetchTime,
    staleMs = 30000,
  } = input;

  if (isRefresh || isFirstLoad || overrideNbId !== undefined || hasExplicitSelection) {
    return true;
  }

  if (targetNbId && targetNbId !== activeNbId) {
    return true;
  }

  if (dataVersion !== loadedDataVersion) {
    return true;
  }

  return now - lastFetchTime >= staleMs;
}

/**
 * 过滤离线缓存笔记以匹配目标笔记本与父目录层级，防止其他笔记本草稿混入当前列表
 */
export function filterCachedNotesForScope<
  T extends { notebookId?: string; parentId?: string | null }
>(items: T[], targetNbId: string | null, parentId: string | null = null): T[] {
  return items.filter(item => {
    if (targetNbId && item.notebookId && item.notebookId !== targetNbId) {
      return false;
    }
    const itemParent = item.parentId ?? null;
    return itemParent === parentId;
  });
}
