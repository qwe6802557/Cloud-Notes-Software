/**
 * mobileSearchEngine.ts - 移动端零依赖高性能倒排检索核心引擎
 * 与 PC 端保持 100% 算法同构：CJK 细粒度分词、拼音首字母模糊匹配、
 * 关键词相关度打分与上下文智能切片，实现移动端 < 2ms 离线即打即搜。
 */

import {
  SearchIndexDoc,
  getAllSearchIndexDocs,
  saveSearchIndexDocs,
  upsertSearchIndexDoc,
  deleteSearchIndexDoc,
} from '../storage/mobileNotesDB';
import * as notesApi from '../../api/notesApi';

// 拼音首字母边界表 (基于 GB2312/Unicode 拼音首字母排序)
const PINYIN_BOUNDARIES = [
  { initial: 'a', char: '啊' }, { initial: 'b', char: '芭' },
  { initial: 'c', char: '擦' }, { initial: 'd', char: '搭' },
  { initial: 'e', char: '蛾' }, { initial: 'f', char: '发' },
  { initial: 'g', char: '噶' }, { initial: 'h', char: '哈' },
  { initial: 'j', char: '击' }, { initial: 'k', char: '喀' },
  { initial: 'l', char: '垃' }, { initial: 'm', char: '妈' },
  { initial: 'n', char: '拿' }, { initial: 'o', char: '哦' },
  { initial: 'p', char: '啪' }, { initial: 'q', char: '期' },
  { initial: 'r', char: '然' }, { initial: 's', char: '撒' },
  { initial: 't', char: '塌' }, { initial: 'w', char: '挖' },
  { initial: 'x', char: '昔' }, { initial: 'y', char: '压' },
  { initial: 'z', char: '匝' },
];

// 单字拼音首字母轻量内存缓存，杜绝循环重复比对造成的 JS 线程卡死
const pinyinCharCache = new Map<string, string>();
const zhCollator =
  typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN')
    : null;

/**
 * 提取中文字符串拼音首字母简写 (如 "移动端" -> "ydd")
 */
export function getPinyinInitials(str = ''): string {
  if (!str) return '';
  return str
    .split('')
    .map(ch => {
      if (!/[\u4e00-\u9fa5]/.test(ch)) return ch.toLowerCase();
      const cached = pinyinCharCache.get(ch);
      if (cached !== undefined) return cached;

      let initial = '';
      for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
        const cmp = zhCollator
          ? zhCollator.compare(ch, PINYIN_BOUNDARIES[i].char)
          : ch.localeCompare(PINYIN_BOUNDARIES[i].char);
        if (cmp >= 0) {
          initial = PINYIN_BOUNDARIES[i].initial;
          break;
        }
      }
      pinyinCharCache.set(ch, initial);
      return initial;
    })
    .join('');
}

/**
 * 清除 Markdown 格式标签以获取干净纯文本
 */
export function stripMarkdown(md = ''): string {
  if (!md) return '';
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\[\[(.*?)(?:\|.*?)?\]\]/g, '$1')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/#+\s+/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/>\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 细粒度分词器：提取 CJK Unigram、Bigram 与拉丁单词
 */
export function tokenize(text = ''): string[] {
  if (!text) return [];
  const tokens = new Set<string>();
  const clean = text.toLowerCase();

  // 1. CJK 单字与双字滑动窗口
  const cjkChars = clean.match(/[\u4e00-\u9fa5]/g) || [];
  for (let i = 0; i < cjkChars.length; i++) {
    tokens.add(cjkChars[i]);
    if (i < cjkChars.length - 1) {
      tokens.add(cjkChars[i] + cjkChars[i + 1]);
    }
  }

  // 2. 英文与数字词干切分
  const words = clean.split(/[^a-z0-9_]/).filter(w => w.length > 0);
  for (const w of words) {
    tokens.add(w);
  }

  return Array.from(tokens);
}

/**
 * 截取包含搜索关键词的上下文片段
 */
export function extractSnippet(content = '', query = '', maxLength = 75): string {
  if (!content) return '';
  const clean = stripMarkdown(content);
  if (!query) return clean.slice(0, maxLength);

  const lowerContent = clean.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();

  let index = lowerContent.indexOf(lowerQuery);
  if (index === -1) {
    for (const ch of lowerQuery) {
      if (ch.trim()) {
        index = lowerContent.indexOf(ch);
        if (index !== -1) break;
      }
    }
  }

  if (index === -1) {
    return clean.slice(0, maxLength) + (clean.length > maxLength ? '...' : '');
  }

  const start = Math.max(0, index - 25);
  const end = Math.min(clean.length, start + maxLength);
  let snippet = clean.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < clean.length) snippet = snippet + '...';
  return snippet;
}

export interface SearchResultItem {
  id: string;
  _id: string;
  title: string;
  snippet: string;
  notebookId: string;
  notebookName: string;
  notebookColor: string;
  updatedAt: string;
  isStarred?: boolean;
  score: number;
}

class MobileSearchEngine {
  private docs: Map<string, SearchIndexDoc & { pinyinInitials?: string }> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private persistTimer: any = null;

  /**
   * 防抖异步落盘，彻底解决并发写 AsyncStorage 导致的桥接堵塞与卡死
   */
  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      saveSearchIndexDocs(Array.from(this.docs.values())).catch(e =>
        console.warn('[MobileSearchEngine] Persist error:', e)
      );
    }, 1200);
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const cachedDocs = await getAllSearchIndexDocs();
        if (Array.isArray(cachedDocs) && cachedDocs.length > 0) {
          this.buildIndex(cachedDocs);
        }

        // 延迟 2.5 秒后在后台静默预热增量索引，确保主页首屏渲染拥有 100% 优先级
        setTimeout(() => {
          this.syncWithServer().catch(err => {
            console.warn('[MobileSearchEngine] sync warn:', err.message);
          });
        }, 2500);
      } catch (e) {
        console.warn('[MobileSearchEngine] init error:', e);
      } finally {
        this.isInitialized = true;
      }
    })();

    return this.initPromise;
  }

  buildIndex(docs: SearchIndexDoc[] = []): void {
    this.docs.clear();
    this.invertedIndex.clear();

    for (const rawDoc of docs) {
      if (!rawDoc || !rawDoc.id) continue;
      this.indexSingleDoc(rawDoc);
    }
  }

  indexSingleDoc(rawDoc: any): void {
    const id = String(rawDoc.id || rawDoc._id);
    const title = rawDoc.title || '';
    const snippet =
      rawDoc.snippet ||
      stripMarkdown(rawDoc.content || rawDoc.rawContent || '').slice(0, 300);
    const pinyinInitials = getPinyinInitials(title);

    const doc: SearchIndexDoc & { pinyinInitials?: string } = {
      id,
      title,
      snippet,
      pinyinInitials,
      notebookId: rawDoc.notebookId || '',
      notebookName: rawDoc.notebookName || '默认笔记本',
      notebookColor: rawDoc.notebookColor || '#3b82f6',
      updatedAt: rawDoc.updatedAt || new Date().toISOString(),
      isStarred: Boolean(rawDoc.isStarred),
    };

    this.docs.set(id, doc);

    const titleTokens = tokenize(title);
    const snippetTokens = tokenize(snippet);
    const allTokens = new Set([...titleTokens, ...snippetTokens]);
    if (pinyinInitials) {
      allTokens.add(pinyinInitials);
    }

    allTokens.forEach(token => {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    });
  }

  /**
   * 批量增量更新索引 (纯内存操作，合并防抖落盘)
   */
  batchUpsertDocuments(docs: any[]): void {
    if (!Array.isArray(docs) || docs.length === 0) return;
    for (const doc of docs) {
      if (!doc || !(doc.id || doc._id)) continue;
      const id = String(doc.id || doc._id);
      this.removeDocument(id, false);
      this.indexSingleDoc(doc);
    }
    this.schedulePersist();
  }

  upsertDocument(doc: any): void {
    if (!doc || !(doc.id || doc._id)) return;
    const id = String(doc.id || doc._id);

    this.removeDocument(id, false);
    this.indexSingleDoc(doc);
    this.schedulePersist();
  }

  removeDocument(id: string, persist = true): void {
    if (!id) return;
    const docId = String(id);
    this.docs.delete(docId);

    this.invertedIndex.forEach(docSet => {
      docSet.delete(docId);
    });

    if (persist) {
      deleteSearchIndexDoc(docId).catch(e =>
        console.warn('[MobileSearchEngine] Delete DB warn:', e)
      );
    }
  }

  async syncWithServer(): Promise<void> {
    try {
      const res = await notesApi.syncNoteIndex();
      const items = res?.data?.items || (res as any)?.items || [];
      if (Array.isArray(items)) {
        this.buildIndex(items);
        await saveSearchIndexDocs(Array.from(this.docs.values()));
      }
    } catch (err: any) {
      console.warn('[MobileSearchEngine] syncWithServer failed:', err.message);
    }
  }

  search(
    query = '',
    options: { limit?: number; notebookId?: string } = {}
  ): { items: SearchResultItem[]; total: number; latencyMs: number } {
    const startTime = Date.now();
    const trimmed = (query || '').trim();
    const { limit = 30, notebookId = undefined } = options;

    if (!trimmed) {
      return { items: [], total: 0, latencyMs: 0 };
    }

    const lowerQuery = trimmed.toLowerCase();
    const queryTokens = tokenize(trimmed);
    const queryPinyin = lowerQuery.replace(/[^a-z]/g, '');

    const scoreMap = new Map<string, number>();

    queryTokens.forEach(token => {
      const matchedDocIds = this.invertedIndex.get(token);
      if (matchedDocIds) {
        matchedDocIds.forEach(id => {
          const currentScore = scoreMap.get(id) || 0;
          scoreMap.set(id, currentScore + 2.0);
        });
      }
    });

    if (queryPinyin && queryPinyin.length >= 2) {
      this.docs.forEach((doc, id) => {
        if (doc.pinyinInitials && doc.pinyinInitials.includes(queryPinyin)) {
          const currentScore = scoreMap.get(id) || 0;
          scoreMap.set(id, currentScore + 4.0);
        }
      });
    }

    const candidates: Array<{ doc: SearchIndexDoc; score: number }> = [];
    scoreMap.forEach((baseScore, id) => {
      const doc = this.docs.get(id);
      if (!doc) return;
      if (notebookId && doc.notebookId !== notebookId) return;

      let score = baseScore;
      const lowerTitle = doc.title.toLowerCase();
      const lowerSnippet = doc.snippet.toLowerCase();

      if (lowerTitle === lowerQuery) {
        score += 25.0;
      } else if (lowerTitle.startsWith(lowerQuery)) {
        score += 12.0;
      } else if (lowerTitle.includes(lowerQuery)) {
        score += 8.0;
      }

      if (lowerSnippet.includes(lowerQuery)) {
        score += 3.0;
      }

      if (doc.updatedAt) {
        const ageDays = (Date.now() - new Date(doc.updatedAt).getTime()) / (1000 * 3600 * 24);
        if (ageDays < 7) {
          score += Math.max(0, 1.5 - ageDays * 0.2);
        }
      }

      candidates.push({ doc, score });
    });

    candidates.sort((a, b) => b.score - a.score);

    const items: SearchResultItem[] = candidates.slice(0, limit).map(({ doc, score }) => ({
      id: doc.id,
      _id: doc.id,
      title: doc.title,
      snippet: extractSnippet(doc.snippet, trimmed, 80),
      notebookId: doc.notebookId,
      notebookName: doc.notebookName,
      notebookColor: doc.notebookColor,
      updatedAt: doc.updatedAt,
      isStarred: doc.isStarred,
      score: Math.round(score * 10) / 10,
    }));

    const latencyMs = Math.max(0.1, Date.now() - startTime);

    return {
      items,
      total: candidates.length,
      latencyMs,
    };
  }

  getTotalDocsCount(): number {
    return this.docs.size;
  }

  getRecentDocs(limit = 5): SearchResultItem[] {
    const all = Array.from(this.docs.values());
    all.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
    return all.slice(0, limit).map(doc => ({
      id: doc.id,
      _id: doc.id,
      title: doc.title,
      snippet: doc.snippet || '',
      notebookId: doc.notebookId,
      notebookName: doc.notebookName,
      notebookColor: doc.notebookColor,
      updatedAt: doc.updatedAt,
      score: 1.0,
    }));
  }
}

export const mobileSearchEngine = new MobileSearchEngine();
