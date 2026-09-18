import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as notesApi from '../../api/notesApi';
import { Note } from '../../api/types';

export default function FolderDetailScreen() {
  const router = useRouter();
  const {
    id: folderId,
    title: initialTitle,
    notebookId: initialNotebookId,
    notebookName: initialNotebookName,
  } = useLocalSearchParams<{
    id: string;
    title?: string;
    notebookId?: string;
    notebookName?: string;
  }>();

  const [folderTitle, setFolderTitle] = useState(initialTitle || '文件夹');
  const [notebookId, setNotebookId] = useState(initialNotebookId || '');
  const [notebookName, setNotebookName] = useState(initialNotebookName || '笔记本');
  const [childItems, setChildItems] = useState<Note[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 加载当前文件夹详情与内部笔记/子文件夹
  const loadFolderData = useCallback(async (isRefresh = false) => {
    if (!folderId) return;

    try {
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      let currentNbId = notebookId;

      // 若未传入笔记本信息，补充拉取该文件夹本身的详情以获取其所属笔记本
      if (!currentNbId || !folderTitle || folderTitle === '文件夹') {
        const folderDetailRes = await notesApi.getNoteDetail(folderId).catch(() => null);
        if (folderDetailRes && folderDetailRes.code === 200 && folderDetailRes.data) {
          if (folderDetailRes.data.title) {
            setFolderTitle(folderDetailRes.data.title);
          }
          if (folderDetailRes.data.notebookId) {
            currentNbId = folderDetailRes.data.notebookId;
            setNotebookId(currentNbId);
          }
        }
      }

      // 拉取文件夹内的子项 (parentId = folderId)
      if (currentNbId) {
        const res = await notesApi.getNotebookNotes(currentNbId, {
          parentId: folderId,
        });

        if (res.code === 200 && Array.isArray(res.data)) {
          setChildItems(res.data);
        }
      }
    } catch (e: any) {
      console.warn('Load folder children error:', e?.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [folderId, notebookId, folderTitle]);

  useFocusEffect(
    useCallback(() => {
      loadFolderData();
    }, [loadFolderData])
  );

  const toggleStar = async (item: Note) => {
    const newStatus = !item.isStarred;
    setChildItems(prev =>
      prev.map(n => (n._id === item._id ? { ...n, isStarred: newStatus } : n))
    );
    try {
      await notesApi.updateNoteStarred(item._id, newStatus);
    } catch (e) {
      setChildItems(prev =>
        prev.map(n => (n._id === item._id ? { ...n, isStarred: !newStatus } : n))
      );
    }
  };

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

  const filteredItems = childItems.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (item.title && item.title.toLowerCase().includes(q)) ||
      (item.content && item.content.toLowerCase().includes(q))
    );
  });

  const renderItem = ({ item }: { item: Note }) => {
    const isSubFolder = item.type === 'folder';

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (isSubFolder) {
            router.push({
              pathname: '/folder/[id]',
              params: {
                id: item._id,
                title: item.title,
                notebookId: item.notebookId || notebookId,
                notebookName,
              },
            });
          } else {
            router.push({
              pathname: '/note/[id]',
              params: { id: item._id },
            });
          }
        }}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Ionicons
              name={isSubFolder ? 'folder' : 'document-text-outline'}
              size={18}
              color={isSubFolder ? '#f59e0b' : '#3b82f6'}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || (isSubFolder ? '新建文件夹' : '无标题笔记')}
            </Text>
          </View>

          {isSubFolder ? (
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

        <Text style={[styles.cardSnippet, isSubFolder && styles.folderSnippet]} numberOfLines={2}>
          {isSubFolder ? '📁 点击浏览子文件夹内容' : cleanSnippet(item.content)}
        </Text>

        <View style={styles.cardFooter}>
          <Text style={styles.cardDate}>{formatDate(item.updatedAt || item.createdAt)}</Text>
          <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: folderTitle,
          headerBackTitle: '返回',
        }}
      />

      {/* 面包屑导航条 */}
      <View style={styles.breadcrumbBar}>
        <TouchableOpacity
          style={styles.breadcrumbItem}
          onPress={() => router.replace('/(tabs)')}
        >
          <Ionicons name="home-outline" size={14} color="#64748b" style={{ marginRight: 3 }} />
          <Text style={styles.breadcrumbLink}>全部笔记</Text>
        </TouchableOpacity>

        <Ionicons name="chevron-forward" size={12} color="#cbd5e1" style={styles.breadcrumbDivider} />

        <View style={styles.breadcrumbItem}>
          <Ionicons name="book-outline" size={13} color="#64748b" style={{ marginRight: 3 }} />
          <Text style={styles.breadcrumbText} numberOfLines={1}>
            {notebookName}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={12} color="#cbd5e1" style={styles.breadcrumbDivider} />

        <View style={[styles.breadcrumbItem, { flexShrink: 1 }]}>
          <Ionicons name="folder-open" size={13} color="#f59e0b" style={{ marginRight: 3 }} />
          <Text style={styles.breadcrumbCurrent} numberOfLines={1}>
            {folderTitle}
          </Text>
        </View>
      </View>

      {/* 搜索框 */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#94a3b8" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索此文件夹内的笔记..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* 文件夹内容统计 */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          包含 {childItems.length} 项内容
        </Text>
      </View>

      {/* 列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={item => item._id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadFolderData(true)}
              colors={['#1890ff']}
              tintColor="#1890ff"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="folder-open-outline" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>文件夹为空</Text>
              <Text style={styles.emptyDesc}>
                {searchQuery
                  ? '未找到符合条件的笔记'
                  : '点击右下角按钮在此文件夹内创建新笔记'}
              </Text>
            </View>
          }
        />
      )}

      {/* 新建笔记浮动按钮 (FAB) */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          router.push({
            pathname: '/note/edit',
            params: {
              notebookId,
              parentId: folderId,
            },
          })
        }
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color="#ffffff" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbLink: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: '500',
  },
  breadcrumbText: {
    fontSize: 12,
    color: '#64748b',
    maxWidth: 90,
  },
  breadcrumbCurrent: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
    maxWidth: 120,
  },
  breadcrumbDivider: {
    marginHorizontal: 6,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 0,
  },
  statsBar: {
    paddingHorizontal: 18,
    paddingVertical: 4,
  },
  statsText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 80,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
  },
  starButton: {
    padding: 2,
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
    marginBottom: 10,
  },
  folderSnippet: {
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDate: {
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 12,
    marginBottom: 6,
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
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
});
