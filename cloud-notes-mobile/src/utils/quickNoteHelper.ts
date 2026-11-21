import type { QuickMemoItem, QuickMemoLink, QuickMemoStorageType } from '../api/quickNotesApi';

export type QuickScopeTab = 'all' | QuickMemoStorageType;
export type QuickKindFilter = 'all' | 'text_link' | 'image' | 'file';

export interface QuickVirtualFolder {
  key: string;
  name: string;
  fullPath: string;
  topLevelFolder: string;
  storageType: QuickMemoStorageType;
  items: QuickMemoItem[];
  totalSize: number;
  minRemaining: number | null;
  minExpireAt: string | null;
}

const HTTP_URL_REGEX = /https?:\/\/[^\s<>"'`\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]+/gi;
const TRAILING_PUNCT_REGEX = /[.,;:!?'"]+$/;

/**
 * 计算字符串 UTF-8 字节长度（与服务端 Buffer.byteLength 严格对齐）
 */
export function getUtf8ByteLength(text = ''): number {
  if (!text) return 0;
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}

/**
 * 校验是否为允许的 http/https 安全外链（拦截 javascript:/data:/file: 等协议）
 */
export function isSafeHttpUrl(rawUrl?: string | null): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function stripTrailingPunctAndUnbalancedBrackets(rawUrl: string): string {
  let candidate = rawUrl.replace(TRAILING_PUNCT_REGEX, '').trim();
  while (
    candidate.endsWith(')') &&
    (candidate.match(/\(/g) || []).length < (candidate.match(/\)/g) || []).length
  ) {
    candidate = candidate.slice(0, -1);
  }
  while (
    candidate.endsWith(']') &&
    (candidate.match(/\[/g) || []).length < (candidate.match(/\]/g) || []).length
  ) {
    candidate = candidate.slice(0, -1);
  }
  return candidate.replace(TRAILING_PUNCT_REGEX, '').trim();
}

/**
 * 从文本中提取并去重安全的 http/https 外链列表
 */
export function extractSafeLinks(text?: string | null): QuickMemoLink[] {
  if (!text || typeof text !== 'string') return [];
  const matches = text.match(HTTP_URL_REGEX);
  if (!matches) return [];

  const seen = new Set<string>();
  const result: QuickMemoLink[] = [];

  for (const raw of matches) {
    const cleaned = stripTrailingPunctAndUnbalancedBrackets(raw);
    if (!isSafeHttpUrl(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    let host = '';
    try {
      host = new URL(cleaned).host;
    } catch {
      host = '';
    }
    result.push({ url: cleaned, host });
  }

  return result;
}

/**
 * 计算服务端与本机的时钟偏移量（毫秒）以消除倒计时误差
 */
export function computeServerClockOffset(
  serverTimeIso?: string | null,
  clientNowMs = Date.now()
): number {
  if (!serverTimeIso) return 0;
  const serverMs = new Date(serverTimeIso).getTime();
  if (Number.isNaN(serverMs)) return 0;
  return serverMs - clientNowMs;
}

/**
 * 基于 expireAt 与时钟偏移计算当前剩余秒数
 */
export function computeRemainingSeconds(
  expireAt?: string | null,
  serverOffsetMs = 0,
  clientNowMs = Date.now()
): number | null {
  if (!expireAt) return null;
  const expireMs = new Date(expireAt).getTime();
  if (Number.isNaN(expireMs)) return null;
  const alignedNowMs = clientNowMs + serverOffsetMs;
  return Math.max(0, Math.floor((expireMs - alignedNowMs) / 1000));
}

export function formatCountdown(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds <= 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes = 0, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getItemKey(item: QuickMemoItem): string {
  return item._id || item.id;
}

function isExpiredTemp(item: QuickMemoItem, alignedNowMs: number): boolean {
  if (item.storageType !== 'temp' || !item.expireAt) return false;
  const expireMs = new Date(item.expireAt).getTime();
  return !Number.isNaN(expireMs) && expireMs <= alignedNowMs;
}

export function sortQuickMemosAscending(items: QuickMemoItem[]): QuickMemoItem[] {
  return [...items].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return getItemKey(a).localeCompare(getItemKey(b));
  });
}

/**
 * 合流增量 delta 数据：处理新/改条目、软删墓碑、存量旧 StashFile 列表，并按创建时间升序返回
 */
export function mergeQuickMemoDelta(
  currentItems: QuickMemoItem[],
  delta: { items?: QuickMemoItem[]; legacyItems?: QuickMemoItem[] },
  serverOffsetMs = 0,
  clientNowMs = Date.now()
): QuickMemoItem[] {
  const alignedNowMs = clientNowMs + serverOffsetMs;
  const map = new Map<string, QuickMemoItem>();

  for (const item of currentItems) {
    const key = getItemKey(item);
    if (!key) continue;
    // 若传入 legacyItems 全量快照，先剔除旧 legacy 项等待重新对齐
    if (delta.legacyItems && item.legacySource === 'stash') {
      continue;
    }
    if (!item.isDeleted && !isExpiredTemp(item, alignedNowMs)) {
      map.set(key, item);
    }
  }

  for (const patch of delta.items || []) {
    const key = getItemKey(patch);
    if (!key) continue;
    if (patch.isDeleted || isExpiredTemp(patch, alignedNowMs)) {
      map.delete(key);
    } else {
      map.set(key, patch);
    }
  }

  for (const legacy of delta.legacyItems || []) {
    const key = getItemKey(legacy);
    if (!key) continue;
    if (!legacy.isDeleted && !isExpiredTemp(legacy, alignedNowMs)) {
      map.set(key, legacy);
    }
  }

  return sortQuickMemosAscending(Array.from(map.values()));
}

/**
 * 按分 partition (all/temp/permanent) 与内容类型过滤展示条目
 */
export function filterQuickMemos(
  items: QuickMemoItem[],
  scopeTab: QuickScopeTab,
  kindFilter: QuickKindFilter,
  serverOffsetMs = 0,
  clientNowMs = Date.now()
): QuickMemoItem[] {
  const alignedNowMs = clientNowMs + serverOffsetMs;
  return items.filter(item => {
    if (item.isDeleted || isExpiredTemp(item, alignedNowMs)) return false;
    if (scopeTab !== 'all' && item.storageType !== scopeTab) return false;
    if (kindFilter === 'text_link') {
      return item.kind === 'text' || item.kind === 'link';
    }
    if (kindFilter === 'image') {
      return item.kind === 'image';
    }
    if (kindFilter === 'file') {
      return item.kind === 'file';
    }
    return true;
  });
}

function normalizeRelativeSegments(rawPath?: string): string[] {
  if (!rawPath) return [];
  return rawPath
    .replace(/\\/g, '/')
    .split('/')
    .map(seg => seg.trim())
    .filter(seg => seg.length > 0 && seg !== '.' && seg !== '..');
}

/**
 * 按当前层级路径构建虚拟文件夹与直属附件视图（按 storageType + 目录名隔离防止永久与临时目录混叠）
 */
export function buildQuickFolderTree(
  items: QuickMemoItem[],
  currentPath: string,
  serverOffsetMs = 0,
  clientNowMs = Date.now(),
  folderStorageScope: QuickMemoStorageType | null = null
): { folders: QuickVirtualFolder[]; files: QuickMemoItem[] } {
  const prefix = currentPath ? `${currentPath}/` : '';
  const folderMap = new Map<string, QuickVirtualFolder>();
  const directFiles: QuickMemoItem[] = [];

  for (const item of items) {
    if (!item.attachment) continue;
    if (folderStorageScope && item.storageType !== folderStorageScope) continue;

    const att = item.attachment;
    const pathSegs = normalizeRelativeSegments(att.relativePath);
    let relPath = pathSegs.join('/');
    if (!relPath) {
      const folderSegs = normalizeRelativeSegments(att.folderName);
      const safeName = att.originalName || att.filename;
      relPath = folderSegs.length > 0 ? `${folderSegs[0]}/${safeName}` : safeName;
    }

    if (prefix) {
      if (!relPath.startsWith(prefix)) continue;
      relPath = relPath.slice(prefix.length);
    }

    if (relPath.includes('/')) {
      const subFolderName = relPath.split('/')[0];
      const fullSubFolderPath = currentPath ? `${currentPath}/${subFolderName}` : subFolderName;
      const folderKey = `${item.storageType}:${fullSubFolderPath}`;
      let folder = folderMap.get(folderKey);
      if (!folder) {
        folder = {
          key: folderKey,
          name: subFolderName,
          fullPath: fullSubFolderPath,
          topLevelFolder: fullSubFolderPath.split('/')[0],
          storageType: item.storageType,
          items: [],
          totalSize: 0,
          minRemaining: null,
          minExpireAt: null,
        };
        folderMap.set(folderKey, folder);
      }
      folder.items.push(item);
      folder.totalSize += att.size || 0;
      const rem = computeRemainingSeconds(item.expireAt, serverOffsetMs, clientNowMs);
      if (rem !== null) {
        folder.minRemaining = folder.minRemaining === null ? rem : Math.min(folder.minRemaining, rem);
      }
      if (item.storageType === 'temp' && item.expireAt) {
        const expMs = new Date(item.expireAt).getTime();
        const prevMs = folder.minExpireAt ? new Date(folder.minExpireAt).getTime() : Infinity;
        if (!Number.isNaN(expMs) && expMs < prevMs) {
          folder.minExpireAt = item.expireAt;
        }
      }
    } else {
      directFiles.push(item);
    }
  }

  return {
    folders: Array.from(folderMap.values()),
    files: directFiles,
  };
}

/**
 * 为「一键转存为正式笔记」生成简洁默认标题
 */
export function buildDefaultNoteTitle(item: QuickMemoItem): string {
  if (item.attachment?.originalName) {
    const rawName = item.attachment.originalName.trim();
    const dotIndex = rawName.lastIndexOf('.');
    return dotIndex > 0 ? rawName.slice(0, dotIndex) : rawName;
  }

  const firstLine = (item.content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);

  if (firstLine) {
    return firstLine.length > 36 ? `${firstLine.slice(0, 36)}...` : firstLine;
  }

  if (item.links?.[0]?.host) {
    return item.links[0].host;
  }

  return '随心记转存';
}

export function createQuickClientId(prefix = 'qm'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
