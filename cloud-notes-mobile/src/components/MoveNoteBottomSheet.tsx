import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as notesApi from '../api/notesApi';
import { TargetDestination, DestinationFolder } from '../api/notesApi';

interface MoveNoteBottomSheetProps {
  visible: boolean;
  noteId: string;
  noteTitle: string;
  isFolder?: boolean;
  currentNotebookId?: string;
  currentParentId?: string | null;
  onClose: () => void;
  onSuccess: (targetNotebookId: string, targetParentId: string | null) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function MoveNoteBottomSheet({
  visible,
  noteId,
  noteTitle,
  isFolder = false,
  currentNotebookId,
  currentParentId = null,
  onClose,
  onSuccess,
}: MoveNoteBottomSheetProps) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [destinations, setDestinations] = useState<TargetDestination[]>([]);
  const [expandedNbIds, setExpandedNbIds] = useState<Set<string>>(new Set());
  const [selectedTarget, setSelectedTarget] = useState<{
    notebookId: string;
    folderId: string | null;
    displayPath: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // 加载全量目标树
  const loadDestinations = useCallback(async () => {
    try {
      setLoading(true);
      const res = await notesApi.getTargetDestinations();
      if (res?.code === 200 && Array.isArray(res?.data?.destinations)) {
        setDestinations(res.data.destinations);
        // 默认展开当前所属笔记本
        if (currentNotebookId) {
          setExpandedNbIds(new Set([currentNotebookId]));
        }
      } else {
        throw new Error(res?.message || '获取目标位置失败');
      }
    } catch (err: any) {
      Alert.alert('提示', err?.message || '加载目录树失败');
    } finally {
      setLoading(false);
    }
  }, [currentNotebookId]);

  useEffect(() => {
    if (visible) {
      setSelectedTarget(null);
      setSearchQuery('');
      loadDestinations();
    }
  }, [visible, loadDestinations]);

  // 递归收集该节点下所有子孙目录ID（防止移动到自身或子孙目录）
  const descendantFolderIds = useMemo(() => {
    if (!isFolder || !noteId) return new Set<string>();
    const set = new Set<string>();

    const traverse = (folders: DestinationFolder[]) => {
      for (const f of folders) {
        if (f.id === noteId) {
          const collect = (children: DestinationFolder[]) => {
            for (const c of children) {
              set.add(c.id);
              if (c.children?.length) collect(c.children);
            }
          };
          if (f.children?.length) collect(f.children);
          return true;
        }
        if (f.children?.length && traverse(f.children)) return true;
      }
      return false;
    };

    for (const nb of destinations) {
      if (traverse(nb.folders || [])) break;
    }
    return set;
  }, [destinations, isFolder, noteId]);

  // 切换折叠笔记本
  const toggleNotebook = (nbId: string) => {
    setExpandedNbIds(prev => {
      const next = new Set(prev);
      if (next.has(nbId)) {
        next.delete(nbId);
      } else {
        next.add(nbId);
      }
      return next;
    });
  };

  // 确认提交移动
  const handleConfirmMove = async () => {
    if (!selectedTarget) {
      Alert.alert('提示', '请选择要移动到的目标位置');
      return;
    }

    try {
      setSubmitting(true);
      const res = await notesApi.moveNote(noteId, {
        targetParentId: selectedTarget.folderId,
        notebookId: selectedTarget.notebookId,
      });

      if (res?.code === 200) {
        const effectiveNbId = res?.data?.targetNotebookId || selectedTarget.notebookId;
        onSuccess(effectiveNbId, selectedTarget.folderId);
        onClose();
      } else {
        throw new Error(res?.message || '移动失败');
      }
    } catch (err: any) {
      Alert.alert('移动失败', err?.message || '网络异常，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 过滤笔记本与文件夹
  const filteredDestinations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return destinations;

    const filterFolder = (f: DestinationFolder): DestinationFolder | null => {
      const titleMatch = f.title.toLowerCase().includes(q);
      const matchingChildren = (f.children || [])
        .map(c => filterFolder(c))
        .filter(Boolean) as DestinationFolder[];

      if (titleMatch || matchingChildren.length > 0) {
        return {
          ...f,
          children: matchingChildren,
        };
      }
      return null;
    };

    return destinations
      .map(nb => {
        const nbMatch = nb.name.toLowerCase().includes(q);
        const filteredFolders = (nb.folders || [])
          .map(f => filterFolder(f))
          .filter(Boolean) as DestinationFolder[];

        if (nbMatch || filteredFolders.length > 0) {
          return {
            ...nb,
            folders: filteredFolders,
          };
        }
        return null;
      })
      .filter(Boolean) as TargetDestination[];
  }, [destinations, searchQuery]);

  // 递归渲染文件夹树
  const renderFolderItems = (folders: DestinationFolder[], nbId: string, nbName: string, depth = 1) => {
    return folders.map(f => {
      const isSelf = f.id === noteId;
      const isDescendant = descendantFolderIds.has(f.id);
      const isCurrentLoc = currentParentId === f.id && currentNotebookId === nbId;
      const isDisabled = isSelf || isDescendant || isCurrentLoc;

      const isSelected =
        selectedTarget?.folderId === f.id && selectedTarget?.notebookId === nbId;

      let statusBadge = '';
      if (isCurrentLoc) statusBadge = '当前位置';
      else if (isSelf || isDescendant) statusBadge = '不可选';

      return (
        <View key={f.id}>
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={isDisabled}
            style={[
              styles.folderRow,
              { paddingLeft: 16 + depth * 18 },
              isSelected && styles.selectedRow,
              isDisabled && styles.disabledRow,
            ]}
            onPress={() => {
              setSelectedTarget({
                notebookId: nbId,
                folderId: f.id,
                displayPath: `${nbName} / ${f.title}`,
              });
            }}
          >
            <Ionicons
              name={isSelected ? 'folder' : 'folder-outline'}
              size={17}
              color={isSelected ? '#1890ff' : isDisabled ? '#94a3b8' : '#64748b'}
              style={styles.rowIcon}
            />
            <Text
              style={[
                styles.folderTitleText,
                isSelected && styles.selectedText,
                isDisabled && styles.disabledText,
              ]}
              numberOfLines={1}
            >
              {f.title}
            </Text>

            {statusBadge ? (
              <View style={[styles.statusBadge, isCurrentLoc ? styles.currentBadge : styles.invalidBadge]}>
                <Text style={[styles.statusBadgeText, isCurrentLoc ? styles.currentBadgeText : styles.invalidBadgeText]}>
                  {statusBadge}
                </Text>
              </View>
            ) : (
              <View style={[styles.radioCircle, isSelected && styles.radioCircleActive]}>
                {isSelected && <View style={styles.radioInner} />}
              </View>
            )}
          </TouchableOpacity>

          {f.children && f.children.length > 0 && (
            renderFolderItems(f.children, nbId, `${nbName} / ${f.title}`, depth + 1)
          )}
        </View>
      );
    });
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              {/* 顶部指示拖拽条 */}
              <View style={styles.handleBar} />

              {/* 标题栏 */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={styles.headerTitle}>移动到目标位置</Text>
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    将 "{noteTitle || '当前笔记'}" 移至
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* 搜索过滤栏 */}
              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={16} color="#94a3b8" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="搜索笔记本或目录..."
                  placeholderTextColor="#94a3b8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  clearButtonMode="while-editing"
                />
              </View>

              {/* 目标树列表 */}
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#1890ff" />
                  <Text style={styles.loadingText}>正在获取目录结构...</Text>
                </View>
              ) : (
                <ScrollView style={styles.treeScroll} contentContainerStyle={styles.treeScrollContent}>
                  {filteredDestinations.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Ionicons name="folder-open-outline" size={32} color="#cbd5e1" />
                      <Text style={styles.emptyText}>未找到匹配的目标位置</Text>
                    </View>
                  ) : (
                    filteredDestinations.map(nb => {
                      const isCurrentRoot = !currentParentId && currentNotebookId === nb.id;
                      const isSelected =
                        selectedTarget?.notebookId === nb.id && selectedTarget?.folderId === null;
                      const isExpanded = expandedNbIds.has(nb.id);
                      const hasFolders = nb.folders && nb.folders.length > 0;

                      return (
                        <View key={nb.id} style={styles.notebookSection}>
                          {/* 笔记本根目录行 */}
                          <View
                            style={[
                              styles.notebookRow,
                              isSelected && styles.selectedRow,
                              isCurrentRoot && styles.disabledRow,
                            ]}
                          >
                            {/* 折叠切换箭头 */}
                            {hasFolders ? (
                              <TouchableOpacity
                                style={styles.expandTrigger}
                                onPress={() => toggleNotebook(nb.id)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              >
                                <Ionicons
                                  name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                                  size={16}
                                  color="#64748b"
                                />
                              </TouchableOpacity>
                            ) : (
                              <View style={styles.expandPlaceholder} />
                            )}

                            {/* 笔记本标题与选择 */}
                            <TouchableOpacity
                              style={styles.notebookTitleTouchable}
                              activeOpacity={0.7}
                              disabled={isCurrentRoot}
                              onPress={() => {
                                setSelectedTarget({
                                  notebookId: nb.id,
                                  folderId: null,
                                  displayPath: `${nb.name} (根目录)`,
                                });
                              }}
                            >
                              <Ionicons
                                name={isSelected ? 'book' : 'book-outline'}
                                size={18}
                                color={isSelected ? '#1890ff' : '#475569'}
                                style={styles.rowIcon}
                              />
                              <Text
                                style={[
                                  styles.notebookTitleText,
                                  isSelected && styles.selectedText,
                                  isCurrentRoot && styles.disabledText,
                                ]}
                                numberOfLines={1}
                              >
                                {nb.name}
                              </Text>

                              {isCurrentRoot ? (
                                <View style={[styles.statusBadge, styles.currentBadge]}>
                                  <Text style={[styles.statusBadgeText, styles.currentBadgeText]}>当前根目录</Text>
                                </View>
                              ) : (
                                <View style={[styles.radioCircle, isSelected && styles.radioCircleActive]}>
                                  {isSelected && <View style={styles.radioInner} />}
                                </View>
                              )}
                            </TouchableOpacity>
                          </View>

                          {/* 展开的子文件夹 */}
                          {hasFolders && isExpanded && (
                            <View style={styles.foldersContainer}>
                              {renderFolderItems(nb.folders, nb.id, nb.name, 1)}
                            </View>
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              )}

              {/* 底部操作区 */}
              <View style={styles.footer}>
                <View style={styles.selectedPathBox}>
                  <Text style={styles.selectedPathLabel}>移动目标：</Text>
                  <Text style={styles.selectedPathValue} numberOfLines={1}>
                    {selectedTarget?.displayPath || '请在上方点选笔记本或目录'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.confirmButton,
                    (!selectedTarget || submitting) && styles.confirmButtonDisabled,
                  ]}
                  activeOpacity={0.8}
                  disabled={!selectedTarget || submitting}
                  onPress={handleConfirmMove}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>确认移动</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: SCREEN_HEIGHT * 0.78,
    minHeight: SCREEN_HEIGHT * 0.52,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    alignSelf: 'center',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerLeft: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
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
  treeScroll: {
    flex: 1,
  },
  treeScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: '#64748b',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 13,
    color: '#94a3b8',
  },
  notebookSection: {
    marginBottom: 6,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    overflow: 'hidden',
  },
  notebookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
  },
  expandTrigger: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  expandPlaceholder: {
    width: 24,
    marginRight: 4,
  },
  notebookTitleTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    marginRight: 8,
  },
  notebookTitleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  foldersContainer: {
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#f1f5f9',
  },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingRight: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#f8fafc',
  },
  folderTitleText: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
  selectedRow: {
    backgroundColor: '#eff6ff',
  },
  selectedText: {
    color: '#1890ff',
    fontWeight: '600',
  },
  disabledRow: {
    opacity: 0.55,
  },
  disabledText: {
    color: '#94a3b8',
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  currentBadge: {
    backgroundColor: '#f1f5f9',
  },
  currentBadgeText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  invalidBadge: {
    backgroundColor: '#fff1f2',
  },
  invalidBadgeText: {
    fontSize: 11,
    color: '#f43f5e',
    fontWeight: '500',
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radioCircleActive: {
    borderColor: '#1890ff',
    backgroundColor: '#ffffff',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1890ff',
  },
  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  selectedPathBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  selectedPathLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  selectedPathValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  confirmButton: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#94a3b8',
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    letterSpacing: -0.1,
  },
});
