import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notesApi from '../../api/notesApi';
import { Note, Notebook } from '../../api/types';
import { Config } from '../../constants/Config';
import RAGKnowledgeModal from '../../components/RAGKnowledgeModal';
import MoveNoteBottomSheet from '../../components/MoveNoteBottomSheet';
import VaultUnlockModal from '../../components/VaultUnlockModal';
import ActionContextSheet, {
  ActionSheetItem,
  triggerHaptic,
} from '../../components/ActionContextSheet';
import TextPromptModal from '../../components/TextPromptModal';
import * as cryptoVault from '../../utils/cryptoVault';
import { mobileSearchEngine, SearchResultItem } from '../../utils/search/mobileSearchEngine';
import { mobileSyncManager } from '../../utils/storage/mobileSyncManager';
import { getAllCachedNotes } from '../../utils/storage/mobileNotesDB';
import {
  buildNoteFolderActionItems,
  copyNoteWikiLink,
  deleteNoteOrFolder,
  showNotice,
  toggleItemEncryption,
} from '../../utils/noteContextActions';
import {
  filterCachedNotesForScope,
  getNotebookSelectionState,
  getNotesDataVersion,
  markNotebookSelected,
  markNotesDataDirty,
  normalizeRouteParam,
  resolveTargetNotebookId,
  shouldBypassNotesThrottle,
} from '../../utils/notebookNavigationHelper';

const renderHighlightedText = (text: string, query: string, style?: any, highlightStyle?: any) => {
  if (!text) return null;
  if (!query) return <Text style={style}>{text}</Text>;

  const lowerText = text.toLowerCase();
  const lowerKey = query.toLowerCase().trim();
  if (!lowerKey) return <Text style={style}>{text}</Text>;

  const index = lowerText.indexOf(lowerKey);
  if (index === -1) {
    // 尝试字符匹配
    for (const ch of lowerKey) {
      const chIdx = lowerText.indexOf(ch);
      if (chIdx !== -1) {
        const before = text.slice(0, chIdx);
        const match = text.slice(chIdx, chIdx + 1);
        const after = text.slice(chIdx + 1);
        return (
          <Text style={style}>
            {before}
            <Text style={highlightStyle || styles.highlightMark}>{match}</Text>
            {renderHighlightedText(after, query, style, highlightStyle)}
          </Text>
        );
      }
    }
    return <Text style={style}>{text}</Text>;
  }

  const before = text.slice(0, index);
  const match = text.slice(index, index + lowerKey.length);
  const after = text.slice(index + lowerKey.length);

  return (
    <Text style={style}>
      {before}
      <Text style={highlightStyle || styles.highlightMark}>{match}</Text>
      {renderHighlightedText(after, query, style, highlightStyle)}
    </Text>
  );
};

export default function NotesScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    notebookId?: string | string[];
    nbSelectSeq?: string | string[];
  }>();
  const routeNbId = normalizeRouteParam(routeParams.notebookId);
  const routeSelectSeq = normalizeRouteParam(routeParams.nbSelectSeq);

  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchMetrics, setSearchMetrics] = useState({ latencyMs: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRAGModal, setShowRAGModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveTargetNote, setMoveTargetNote] = useState<any>(null);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [pendingEncryptItem, setPendingEncryptItem] = useState<any>(null);
  const [contextSheet, setContextSheet] = useState<{
    title: string;
    subtitle: string;
    items: ActionSheetItem[];
  } | null>(null);
  const [promptConfig, setPromptConfig] = useState<{
    mode: 'rename' | 'create_folder';
    item: any;
    title: string;
    placeholder: string;
    defaultValue: string;
  } | null>(null);

  // SWR 保活控制器：初次挂载冷启动展示 Loading，切 Tab 聚焦时保持 FlatList 存活与滚动位不变
  const hasLoadedOnceRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const activeNotebookIdRef = useRef<string | null>(null);
  const notebooksRef = useRef<Notebook[]>([]);
  const fetchSeqRef = useRef(0);
  const consumedSelectionSeqRef = useRef(0);
  const lastHandledRouteSelectSeqRef = useRef<string | null>(null);
  const loadedDataVersionRef = useRef(-1);
  const latestRouteParamsRef = useRef<{ routeNbId: string | null; routeSelectSeq: string | null }>({
    routeNbId: null,
    routeSelectSeq: null,
  });
  latestRouteParamsRef.current = { routeNbId, routeSelectSeq };

  // 初始化全库倒排索引引擎，并监听笔记同步写入事件驱动列表及时拉新
  useEffect(() => {
    const timer = setTimeout(() => {
      mobileSearchEngine.init();
    }, 200);
    const unsubscribeSync = mobileSyncManager.subscribeNoteSynced(() => {
      markNotesDataDirty();
    });
    return () => {
      clearTimeout(timer);
      unsubscribeSync();
    };
  }, []);

  // 加载数据 (SWR 就地保活模型：仅在同笔记本且无变更且未过期时复用缓存)
  const loadData = useCallback(async (isRefresh = false, overrideNbId?: string | null) => {
    const isFirstLoad = !hasLoadedOnceRef.current;
    const now = Date.now();
    const { routeNbId: currentRouteNbId, routeSelectSeq: currentRouteSelectSeq } =
      latestRouteParamsRef.current;

    const storedNbId = await AsyncStorage.getItem(Config.storageKeys.activeNotebookId).catch(
      () => null
    );
    const selectionState = getNotebookSelectionState();
    const hasPendingInMemorySelection =
      selectionState.selectionSeq > consumedSelectionSeqRef.current;
    const hasPendingRouteSelection = Boolean(
      currentRouteSelectSeq && currentRouteSelectSeq !== lastHandledRouteSelectSeqRef.current
    );
    const hasExplicitSelection = hasPendingInMemorySelection || hasPendingRouteSelection;

    const pendingSelectedNbId = hasPendingInMemorySelection
      ? selectionState.pendingNotebookId
      : null;
    const activeRouteNbId = hasPendingRouteSelection ? currentRouteNbId : null;

    const preliminaryTargetNbId =
      (overrideNbId !== undefined ? overrideNbId : null) ||
      pendingSelectedNbId ||
      activeRouteNbId ||
      storedNbId ||
      activeNotebookIdRef.current;

    const currentDataVersion = getNotesDataVersion();

    if (
      !shouldBypassNotesThrottle({
        isRefresh,
        isFirstLoad,
        overrideNbId,
        hasExplicitSelection,
        targetNbId: preliminaryTargetNbId,
        activeNbId: activeNotebookIdRef.current,
        dataVersion: currentDataVersion,
        loadedDataVersion: loadedDataVersionRef.current,
        now,
        lastFetchTime: lastFetchTimeRef.current,
      })
    ) {
      return;
    }

    consumedSelectionSeqRef.current = selectionState.selectionSeq;
    if (currentRouteSelectSeq) {
      lastHandledRouteSelectSeqRef.current = currentRouteSelectSeq;
    }

    const fetchSeq = ++fetchSeqRef.current;
    const isNotebookSwitching = Boolean(
      preliminaryTargetNbId && preliminaryTargetNbId !== activeNotebookIdRef.current
    );

    if (hasExplicitSelection || isNotebookSwitching || overrideNbId !== undefined) {
      // 从“笔记本”Tab 或过滤器明确进入新笔记本时清空残留搜索词，确保呈现目标笔记本列表
      setSearchQuery('');
      setSearchResults([]);
      setSearchMetrics({ latencyMs: 0, total: 0 });
    }

    let resolvedTargetNbForCatch: string | null = preliminaryTargetNbId;

    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else if (isNotebookSwitching) {
        // 切换至不同笔记本时立即清理上一笔记本旧列表并显示加载态，杜绝旧数据残留或误显示
        setNotes([]);
        if (preliminaryTargetNbId) {
          activeNotebookIdRef.current = preliminaryTargetNbId;
          setActiveNotebookId(preliminaryTargetNbId);
        }
        setIsLoading(true);
      } else if (isFirstLoad) {
        // 本地优先瞬时上屏
        try {
          const cached = await getAllCachedNotes();
          const scopedCached = filterCachedNotesForScope(cached, preliminaryTargetNbId, null);
          if (scopedCached.length > 0) {
            setNotes(
              scopedCached.map(c => ({
                _id: c.id,
                title: c.title,
                content: c.content,
                notebookId: c.notebookId || '',
                parentId: c.parentId ?? null,
                userId: '',
                updatedAt: c.updatedAt,
                createdAt: c.updatedAt,
                isStarred: false,
                tags: [],
              }))
            );
            setIsLoading(false);
          } else {
            setIsLoading(true);
          }
        } catch {
          setIsLoading(true);
        }
      }

      const nbRes = await notesApi
        .getNotebooks()
        .catch(() => ({ code: 500, data: [] as Notebook[] }));

      if (fetchSeq !== fetchSeqRef.current) return;

      const notebooksFetchOk = nbRes.code === 200 && Array.isArray(nbRes.data);
      let loadedNotebooks: Notebook[] = notebooksRef.current;

      if (notebooksFetchOk) {
        // 确保“默认笔记本”排在首位
        loadedNotebooks = [...nbRes.data].sort((a, b) => {
          const aIsDefault = (a.title || a.name) === '默认笔记本';
          const bIsDefault = (b.title || b.name) === '默认笔记本';
          if (aIsDefault && !bIsDefault) return -1;
          if (!aIsDefault && bIsDefault) return 1;
          return 0;
        });
        notebooksRef.current = loadedNotebooks;
        setNotebooks(loadedNotebooks);
      }

      const targetNbId = resolveTargetNotebookId({
        overrideNbId,
        routeNbId: activeRouteNbId,
        pendingSelectedNbId,
        storedNbId,
        previousNbId: activeNotebookIdRef.current,
        loadedNotebooks,
        notebooksFetchOk,
      });

      resolvedTargetNbForCatch = targetNbId;
      activeNotebookIdRef.current = targetNbId;
      setActiveNotebookId(targetNbId);

      if (targetNbId && targetNbId !== storedNbId) {
        AsyncStorage.setItem(Config.storageKeys.activeNotebookId, targetNbId).catch(() => {});
      }

      let notesRes;
      if (targetNbId) {
        notesRes = await notesApi.getNotebookNotes(targetNbId);
      } else {
        notesRes = await notesApi.getRecentNotes();
      }

      if (fetchSeq !== fetchSeqRef.current) return;

      if (notesRes && notesRes.code === 200 && Array.isArray(notesRes.data)) {
        const remoteNotes = notesRes.data;
        const cached = await getAllCachedNotes();
        if (fetchSeq !== fetchSeqRef.current) return;

        const pendingOffline = filterCachedNotesForScope(
          cached.filter(c => c.id.startsWith('local_')),
          targetNbId,
          null
        );
        const mergedNotes: Note[] = [
          ...pendingOffline.map(c => ({
            _id: c.id,
            title: c.title,
            content: c.content,
            notebookId: c.notebookId || targetNbId || '',
            parentId: c.parentId ?? null,
            userId: '',
            updatedAt: c.updatedAt,
            createdAt: c.updatedAt,
            isStarred: false,
            tags: [],
          })),
          ...remoteNotes,
        ];

        setNotes(mergedNotes);
        const currentNb = loadedNotebooks.find(nb => nb._id === targetNbId);
        // 批量极速增量同步进倒排检索内存引擎，合并异步防抖落盘，杜绝 JS 线程与 SQLite 堵塞
        const searchDocs = mergedNotes.map((n: Note) => ({
          id: n._id,
          title: n.title,
          snippet: n.content,
          notebookId: n.notebookId || targetNbId || '',
          notebookName: currentNb?.title || currentNb?.name || '默认笔记本',
          updatedAt: n.updatedAt,
          isStarred: n.isStarred,
        }));
        mobileSearchEngine.batchUpsertDocuments(searchDocs);
        lastFetchTimeRef.current = Date.now();
        loadedDataVersionRef.current = getNotesDataVersion();
      }
    } catch (e: any) {
      if (fetchSeq !== fetchSeqRef.current) return;
      console.warn('Load notes error:', e.message);
      try {
        const cached = await getAllCachedNotes();
        const scopedCached = filterCachedNotesForScope(cached, resolvedTargetNbForCatch, null);
        if (scopedCached.length > 0) {
          setNotes(
            scopedCached.map(c => ({
              _id: c.id,
              title: c.title,
              content: c.content,
              notebookId: c.notebookId || '',
              parentId: c.parentId ?? null,
              userId: '',
              updatedAt: c.updatedAt,
              createdAt: c.updatedAt,
              isStarred: false,
              tags: [],
            }))
          );
        }
      } catch {}
    } finally {
      if (fetchSeq === fetchSeqRef.current) {
        hasLoadedOnceRef.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // 页面聚焦时自动刷新
  useFocusEffect(
    useCallback(() => {
      void loadData();
    }, [loadData])
  );

  // 路由选择序列变化时兜底触发刷新（防止组件未失焦或参数延迟到达）
  useEffect(() => {
    if (routeSelectSeq && routeSelectSeq !== lastHandledRouteSelectSeqRef.current) {
      void loadData();
    }
  }, [routeSelectSeq, loadData]);

  // 搜索输入触发全库穿透毫秒级倒排检索
  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    const trimmed = text.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchMetrics({ latencyMs: 0, total: 0 });
      return;
    }

    const res = mobileSearchEngine.search(trimmed);
    setSearchResults(res.items);
    setSearchMetrics({ latencyMs: res.latencyMs, total: res.total });
  };

  const handleSelectNotebook = async (id: string) => {
    markNotebookSelected(id);
    activeNotebookIdRef.current = id;
    setActiveNotebookId(id);
    setNotes([]);
    await AsyncStorage.setItem(Config.storageKeys.activeNotebookId, id);
    void loadData(false, id);
  };

  const toggleStar = async (item: Note | SearchResultItem) => {
    const targetId = (item as any)._id || (item as any).id;
    const newStatus = !item.isStarred;
    // 乐观更新
    setNotes(prev =>
      prev.map(n => (n._id === targetId ? { ...n, isStarred: newStatus } : n))
    );
    setSearchResults(prev =>
      prev.map(n => (n.id === targetId ? { ...n, isStarred: newStatus } : n))
    );
    try {
      await notesApi.updateNoteStarred(targetId, newStatus);
    } catch (e: any) {
      if (!e?.status) {
        await mobileSyncManager.queueOfflineAction(targetId, 'star', { isStarred: newStatus });
        return;
      }
      // 服务端明确失败时回退
      setNotes(prev =>
        prev.map(n => (n._id === targetId ? { ...n, isStarred: !newStatus } : n))
      );
      setSearchResults(prev =>
        prev.map(n => (n.id === targetId ? { ...n, isStarred: !newStatus } : n))
      );
    }
  };

  // 切换笔记或文件夹加密状态
  const handleToggleEncryption = async (item: any) => {
    await toggleItemEncryption(item, {
      onRequireVaultUnlock: () => {
        setPendingEncryptItem(item);
        setShowVaultModal(true);
      },
      onSuccess: () => {
        void loadData(true);
      },
    });
  };

  // 长按卡片唤起快捷操作面板（在事件处理器内构筑动作清单，遵循 React Compiler 不可变规则）
  const handleNoteLongPress = (item: any) => {
    triggerHaptic('light');
    const isFolder = item?.type === 'folder';
    const items = buildNoteFolderActionItems(item, {
      onToggleStar: target => void toggleStar(target),
      onCopyWikiLink: target => void copyNoteWikiLink(target.title),
      onNewNoteInFolder: folder => {
        const targetId = folder._id || folder.id;
        router.push({
          pathname: '/note/edit',
          params: {
            notebookId: folder.notebookId || activeNotebookId || '',
            parentId: targetId,
          },
        });
      },
      onNewSubfolder: folder => {
        setPromptConfig({
          mode: 'create_folder',
          item: folder,
          title: '新建子文件夹',
          placeholder: '请输入子文件夹名称',
          defaultValue: '',
        });
      },
      onRename: target => {
        setPromptConfig({
          mode: 'rename',
          item: target,
          title: target.type === 'folder' ? '重命名文件夹' : '重命名笔记',
          placeholder: '请输入新名称',
          defaultValue: target.title || '',
        });
      },
      onMove: target => {
        setMoveTargetNote(target);
        setShowMoveModal(true);
      },
      onToggleEncryption: target => void handleToggleEncryption(target),
      onDelete: target => {
        void deleteNoteOrFolder(target, () => {
          void loadData(true);
        });
      },
    });

    setContextSheet({
      title: item?.title || (isFolder ? '未命名文件夹' : '无标题笔记'),
      subtitle: notebooks.find(n => n._id === item?.notebookId)?.title || '笔记本',
      items,
    });
  };

  const isSearching = searchQuery.trim().length > 0;

  // 决定最终展示的笔记列表
  const displayNotes = useMemo(() => {
    if (isSearching) {
      return searchResults;
    }
    return notes.filter(item => !item.parentId);
  }, [isSearching, searchResults, notes]);

  // 清洗 Markdown 特殊语法以展示纯文本摘要 (先切片后正则，大幅提升列表渲染帧率)
  const cleanSnippet = (content?: string) => {
    if (!content) return '暂无内容';
    const rawHead = content.slice(0, 240);
    return rawHead
      .replace(/#+\s+/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '[图片]')
      .replace(/\[.*?\]\(.*?\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/`{1,3}.*?`{1,3}/g, '')
      .trim()
      .slice(0, 80);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (isToday) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderNoteCard = ({ item }: { item: any }) => {
    const isFolder = item.type === 'folder';
    const nbName = item.notebookName || notebooks.find(n => n._id === item.notebookId)?.title || '笔记本';
    const nbColor = item.notebookColor || '#3b82f6';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (isFolder) {
            router.push({
              pathname: '/folder/[id]',
              params: {
                id: item._id,
                title: item.title,
                notebookId: item.notebookId || activeNotebookId || '',
                notebookName: nbName,
              },
            });
          } else {
            router.push({ pathname: '/note/[id]', params: { id: item._id || item.id } });
          }
        }}
        onLongPress={() => handleNoteLongPress(item)}
        delayLongPress={400}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderTitleRow}>
            <Ionicons
              name={isFolder ? 'folder' : 'document-text-outline'}
              size={18}
              color={isFolder ? '#f59e0b' : '#3b82f6'}
              style={{ marginRight: 6 }}
            />
            {isSearching ? (
              renderHighlightedText(
                item.title || '无标题笔记',
                searchQuery.trim(),
                styles.cardTitle
              )
            ) : (
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title || (isFolder ? '未命名文件夹' : '无标题笔记')}
              </Text>
            )}
            {item.isEncrypted && (
              <Ionicons name="lock-closed" size={13} color="#d97706" style={{ marginLeft: 5 }} />
            )}
          </View>
          {isFolder ? (
            <View style={styles.folderBadge}>
              <Text style={styles.folderBadgeText}>文件夹</Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => toggleStar(item)}
              style={styles.starButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={item.isStarred ? 'star' : 'star-outline'}
                size={18}
                color={item.isStarred ? '#eab308' : '#cbd5e1'}
              />
            </TouchableOpacity>
          )}
        </View>

        {isSearching ? (
          <Text style={styles.cardSnippet} numberOfLines={2}>
            {renderHighlightedText(
              item.snippet || cleanSnippet(item.content),
              searchQuery.trim(),
              styles.cardSnippet
            )}
          </Text>
        ) : (
          <Text style={[styles.cardSnippet, isFolder && styles.folderSnippet]} numberOfLines={2}>
            {item.isEncrypted && !cryptoVault.hasSessionKey()
              ? '私密内容（端到端加密保护）'
              : isFolder
              ? '点击浏览文件夹内容'
              : cleanSnippet(item.content)}
          </Text>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <Text style={styles.cardDate}>{formatDate(item.updatedAt || item.createdAt)}</Text>
            <View style={styles.notebookBadge}>
              <View style={[styles.notebookDot, { backgroundColor: nbColor }]} />
              <Text style={styles.notebookBadgeText} numberOfLines={1}>
                {nbName}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部全库搜索与知识库问答栏 */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="全库毫秒级即打即搜 (支持拼音)..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={handleSearchChange}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => handleSearchChange('')}>
              <Ionicons name="close-circle" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.ragAskBtn}
          onPress={() => setShowRAGModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="hardware-chip-outline" size={16} color="#2563eb" />
          <Text style={styles.ragAskBtnText}>知识库</Text>
        </TouchableOpacity>
      </View>

      {/* 搜索性能指标栏 / 分类过滤器栏 */}
      {isSearching ? (
        <View style={styles.searchMetricsBar}>
          <View style={styles.searchMetricsLeft}>
            <Ionicons name="flash" size={13} color="#2563eb" />
            <Text style={styles.searchMetricsText}>
              ⚡ {searchMetrics.latencyMs}ms · 全库命中 {searchMetrics.total} 篇
            </Text>
          </View>
          <Text style={styles.searchMetricsTag}>离线引擎</Text>
        </View>
      ) : (
        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            {notebooks.map(nb => {
              const isActive = activeNotebookId === nb._id;
              return (
                <TouchableOpacity
                  key={nb._id}
                  style={[styles.filterChip, isActive && styles.filterChipActive]}
                  onPress={() => handleSelectNotebook(nb._id)}
                >
                  <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                    {nb.title || nb.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 笔记列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <FlatList
          data={displayNotes}
          keyExtractor={item => item._id || item.id}
          renderItem={renderNoteCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true)}
              colors={['#1890ff']}
              tintColor="#1890ff"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>暂无匹配笔记</Text>
              <Text style={styles.emptyDesc}>
                {isSearching
                  ? `未找到包含 "${searchQuery}" 的笔记，可尝试拼音或更短词`
                  : '点击右下角按钮立即创建第一篇笔记'}
              </Text>
            </View>
          }
        />
      )}

      {/* 新建笔记浮动操作按钮 (FAB) */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          router.push({
            pathname: '/note/edit',
            params: activeNotebookId ? { notebookId: activeNotebookId } : {},
          })
        }
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={30} color="#ffffff" />
      </TouchableOpacity>

      {showRAGModal && (
        <RAGKnowledgeModal
          visible={showRAGModal}
          onClose={() => setShowRAGModal(false)}
          currentNotebookId={activeNotebookId || undefined}
          currentNotebookName={notebooks.find(n => n._id === activeNotebookId)?.title}
        />
      )}

      {moveTargetNote && (
        <MoveNoteBottomSheet
          visible={showMoveModal}
          noteId={moveTargetNote._id || moveTargetNote.id}
          noteTitle={moveTargetNote.title || ''}
          isFolder={moveTargetNote.type === 'folder'}
          currentNotebookId={moveTargetNote.notebookId || activeNotebookId || undefined}
          currentParentId={moveTargetNote.parentId}
          onClose={() => {
            setShowMoveModal(false);
            setMoveTargetNote(null);
          }}
          onSuccess={() => {
            markNotesDataDirty();
            loadData(true);
            Alert.alert('成功', '已移动到新位置');
          }}
        />
      )}
      {/* 安全箱解锁弹窗 */}
      <VaultUnlockModal
        visible={showVaultModal}
        onClose={() => {
          setShowVaultModal(false);
          setPendingEncryptItem(null);
        }}
        onSuccess={() => {
          setShowVaultModal(false);
          if (pendingEncryptItem) {
            void handleToggleEncryption(pendingEncryptItem);
            setPendingEncryptItem(null);
          }
        }}
      />

      {/* 长按上下文动作面板 */}
      <ActionContextSheet
        visible={Boolean(contextSheet)}
        title={contextSheet?.title}
        subtitle={contextSheet?.subtitle}
        items={contextSheet?.items || []}
        onClose={() => setContextSheet(null)}
      />

      {/* 重命名 / 新建子文件夹输入弹窗 */}
      <TextPromptModal
        visible={Boolean(promptConfig)}
        title={promptConfig?.title || ''}
        placeholder={promptConfig?.placeholder}
        defaultValue={promptConfig?.defaultValue}
        confirmLabel="确定"
        onClose={() => setPromptConfig(null)}
        onConfirm={async value => {
          if (!promptConfig) return;
          const target = promptConfig.item;
          const targetId = target._id || target.id;
          try {
            if (promptConfig.mode === 'rename') {
              await notesApi.updateNote(targetId, { title: value });
            } else {
              await notesApi.createNote({
                title: value,
                content: '',
                type: 'folder',
                notebookId: target.notebookId || activeNotebookId || '',
                parentId: targetId,
              });
            }
            markNotesDataDirty();
            void loadData(true);
          } catch (err: any) {
            showNotice('操作失败', err?.message || '网络异常');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  ragAskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    height: 42,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    gap: 4,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  ragAskBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 0,
  },
  searchMetricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchMetricsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchMetricsText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#1e293b',
    fontWeight: '600',
  },
  searchMetricsTag: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  highlightMark: {
    backgroundColor: 'rgba(254, 240, 138, 0.5)',
    color: '#854d0e',
    fontWeight: '600',
  },
  filterRow: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  filterScroll: {
    paddingVertical: 4,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterChipActive: {
    backgroundColor: '#1890ff',
    borderColor: '#1890ff',
  },
  filterChipText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 90,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  starButton: {
    padding: 4,
  },
  folderBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  folderBadgeText: {
    fontSize: 11,
    color: '#d97706',
    fontWeight: '500',
  },
  cardSnippet: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 12,
  },
  folderSnippet: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
  },
  cardFooterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  notebookBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 160,
  },
  notebookDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  notebookBadgeText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  cardDate: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginTop: 12,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
});
