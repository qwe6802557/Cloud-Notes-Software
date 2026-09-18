import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
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
import { Notebook } from '../../api/types';
import { Config } from '../../constants/Config';

export default function NotebooksScreen() {
  const router = useRouter();

  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 新建笔记本弹窗
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNotebookTitle, setNewNotebookTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadNotebooks = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const res = await notesApi.getNotebooks();
      if (res.code === 200 && Array.isArray(res.data)) {
        setNotebooks(res.data);
      }
    } catch (e: any) {
      console.warn('Fetch notebooks failed:', e.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotebooks();
    }, [loadNotebooks])
  );

  const handleSelectNotebook = async (notebook: Notebook) => {
    await AsyncStorage.setItem(Config.storageKeys.activeNotebookId, notebook._id);
    router.navigate('/(tabs)');
  };

  const handleCreateNotebook = async () => {
    if (!newNotebookTitle.trim()) {
      Alert.alert('提示', '请输入笔记本名称');
      return;
    }

    try {
      setIsCreating(true);
      const res = await notesApi.createNotebook({ title: newNotebookTitle.trim() });
      if (res.code === 200) {
        setShowCreateModal(false);
        setNewNotebookTitle('');
        loadNotebooks();
        Alert.alert('成功', '笔记本创建成功');
      } else {
        throw new Error(res.message);
      }
    } catch (e: any) {
      Alert.alert('创建失败', e.message || '网络异常');
    } finally {
      setIsCreating(false);
    }
  };

  const renderNotebookItem = ({ item, index }: { item: Notebook; index: number }) => {
    const isFirst = index === 0;
    const isLast = index === notebooks.length - 1;
    return (
      <TouchableOpacity
        style={[
          styles.itemRow,
          isFirst && styles.itemRowFirst,
          isLast && styles.itemRowLast,
          !isLast && styles.itemRowBorder,
        ]}
        onPress={() => handleSelectNotebook(item)}
        activeOpacity={0.65}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="folder" size={20} color="#1890ff" />
        </View>

        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title || item.name}
          </Text>
          <Text style={styles.itemSub}>点击查看笔记</Text>
        </View>

        <View style={styles.rightAction}>
          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部操作条 */}
      <View style={styles.topActionRow}>
        <Text style={styles.countText}>
          共 <Text style={styles.monoCount}>{notebooks.length}</Text> 个笔记本
        </Text>
        <TouchableOpacity
          style={styles.createBtn}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={18} color="#ffffff" />
          <Text style={styles.createBtnText}>新建笔记本</Text>
        </TouchableOpacity>
      </View>

      {/* 列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <FlatList
          data={notebooks}
          keyExtractor={item => item._id}
          renderItem={renderNotebookItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadNotebooks(true)}
              colors={['#1890ff']}
              tintColor="#1890ff"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="folder-open-outline" size={56} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>暂无笔记本</Text>
              <Text style={styles.emptyDesc}>点击右上角“新建笔记本”开始组织归档</Text>
            </View>
          }
        />
      )}

      {/* 新建笔记本弹窗 */}
      <Modal visible={showCreateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>新建笔记本</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="请输入笔记本标题 (如：面试复习、读书笔记)"
              placeholderTextColor="#94a3b8"
              value={newNotebookTitle}
              onChangeText={setNewNotebookTitle}
              autoFocus
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setShowCreateModal(false)}
                disabled={isCreating}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirmBtn]}
                onPress={handleCreateNotebook}
                disabled={isCreating}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalConfirmText}>创建</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  countText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  monoCount: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
    color: '#0f172a',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1890ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  createBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#e2e8f0',
  },
  itemRowFirst: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
  },
  itemRowLast: {
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    borderBottomWidth: 1,
  },
  itemRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  itemSub: {
    fontSize: 12,
    color: '#94a3b8',
  },
  rightAction: {
    paddingLeft: 8,
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
  },
  emptyDesc: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalCancelBtn: {
    backgroundColor: '#f1f5f9',
  },
  modalCancelText: {
    fontSize: 14,
    color: '#64748b',
  },
  modalConfirmBtn: {
    backgroundColor: '#1890ff',
  },
  modalConfirmText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
});
