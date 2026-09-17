import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notesApi from '../../api/notesApi';
import { Note, Notebook } from '../../api/types';
import { Config } from '../../constants/Config';

export default function NotesScreen() {
  const router = useRouter();

  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 加载数据
  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      // 并行拉取笔记本列表与笔记
      const [nbRes, activeNbStored] = await Promise.all([
        notesApi.getNotebooks().catch(() => ({ code: 500, data: [] as Notebook[] })),
        AsyncStorage.getItem(Config.storageKeys.activeNotebookId).catch(() => null),
      ]);

      if (nbRes.code === 200 && Array.isArray(nbRes.data)) {
        setNotebooks(nbRes.data);
      }

      const targetNbId = activeNotebookId || activeNbStored;
      let notesRes;

      if (targetNbId) {
        notesRes = await notesApi.getNotebookNotes(targetNbId);
      } else {
        // 默认拉取全部笔记 / 最近笔记
        notesRes = await notesApi.getRecentNotes();
      }

      if (notesRes && notesRes.code === 200 && Array.isArray(notesRes.data)) {
        setNotes(notesRes.data);
      }
    } catch (e: any) {
      console.warn('Load notes error:', e.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [activeNotebookId]);

  // 页面聚焦时自动刷新
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleSelectNotebook = async (id: string | null) => {
    setActiveNotebookId(id);
    if (id) {
      await AsyncStorage.setItem(Config.storageKeys.activeNotebookId, id);
    } else {
      await AsyncStorage.removeItem(Config.storageKeys.activeNotebookId);
    }
  };

  const toggleStar = async (item: Note) => {
    const newStatus = !item.isStarred;
    // 乐观更新
    setNotes(prev =>
      prev.map(n => (n._id === item._id ? { ...n, isStarred: newStatus } : n))
    );
    try {
      await notesApi.updateNoteStarred(item._id, newStatus);
    } catch (e) {
      // 失败回退
      setNotes(prev =>
        prev.map(n => (n._id === item._id ? { ...n, isStarred: !newStatus } : n))
      );
    }
  };

  // 过滤笔记
  const filteredNotes = notes.filter(n => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      (n.title && n.title.toLowerCase().includes(query)) ||
      (n.content && n.content.toLowerCase().includes(query))
    );
  });

  const activeNotebook = notebooks.find(nb => nb._id === activeNotebookId);

  // 清洗 Markdown 特殊语法以展示纯文本摘要
  const cleanSnippet = (content: string) => {
    if (!content) return '暂无内容';
    return content
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

  const renderNoteCard = ({ item }: { item: Note }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/note/[id]', params: { id: item._id } })}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title || '无标题笔记'}
        </Text>
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
      </View>

      <Text style={styles.cardSnippet} numberOfLines={2}>
        {cleanSnippet(item.content)}
      </Text>

      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <Text style={styles.cardDate}>{formatDate(item.updatedAt || item.createdAt)}</Text>
          {(() => {
            const nb = notebooks.find(n => n._id === item.notebookId);
            return nb ? (
              <View style={styles.notebookBadge}>
                <Ionicons name="folder-outline" size={11} color="#64748b" style={{ marginRight: 3 }} />
                <Text style={styles.notebookBadgeText} numberOfLines={1}>
                  {nb.title}
                </Text>
              </View>
            ) : null;
          })()}
        </View>
        <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 顶部搜索栏 */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#94a3b8" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索笔记标题或内容..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* 分类过滤器条 */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          <TouchableOpacity
            style={[styles.filterChip, !activeNotebookId && styles.filterChipActive]}
            onPress={() => handleSelectNotebook(null)}
          >
            <Text style={[styles.filterChipText, !activeNotebookId && styles.filterChipTextActive]}>
              全部笔记 ({notes.length})
            </Text>
          </TouchableOpacity>

          {notebooks.map(nb => {
            const isActive = activeNotebookId === nb._id;
            return (
              <TouchableOpacity
                key={nb._id}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => handleSelectNotebook(nb._id)}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {nb.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* 笔记列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <FlatList
          data={filteredNotes}
          keyExtractor={item => item._id}
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
              <Text style={styles.emptyTitle}>暂无相关笔记</Text>
              <Text style={styles.emptyDesc}>
                {searchQuery ? '未找到符合条件的笔记' : '点击右下角按钮立即创建第一篇笔记'}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    paddingVertical: 0,
  },
  filterRow: {
    marginBottom: 8,
  },
  filterScroll: {
    paddingHorizontal: 16,
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
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  starButton: {
    padding: 4,
  },
  cardSnippet: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 12,
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
  notebookBadgeText: {
    fontSize: 11,
    color: '#64748b',
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
