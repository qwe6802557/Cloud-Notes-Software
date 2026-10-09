import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import * as notesApi from '../api/notesApi';
import { Note, NoteHistoryItem } from '../api/types';
import DiffViewer from './DiffViewer';

export interface VersionHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  noteId: string;
  currentContent?: string;
  onRollbackSuccess?: (updatedNote: Note) => void;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/**
 * 历史版本快照管理与 Diff 差异对比弹窗
 */
export default function VersionHistoryModal({
  visible,
  onClose,
  noteId,
  currentContent = '',
  onRollbackSuccess,
}: VersionHistoryModalProps) {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0
  );

  const [viewStage, setViewStage] = useState<'list' | 'detail'>('list');
  const [histories, setHistories] = useState<NoteHistoryItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<NoteHistoryItem | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);

  // 查看模式：'diff' (差异对比) | 'preview' (Markdown 渲染) | 'raw' (源码纯文本)
  const [viewMode, setViewMode] = useState<'diff' | 'preview' | 'raw'>('diff');

  // 对比基准：'current' (最新工作区) | 'previous' (上一快照)
  const [baselineMode, setBaselineMode] = useState<'current' | 'previous'>('current');

  // Diff 布局：'unified' (单列合并) | 'split' (双栏并排)
  const [diffLayout, setDiffLayout] = useState<'unified' | 'split'>('unified');

  // 格式化时间
  const formatTime = (timeStr?: string) => {
    if (!timeStr) return '';
    const d = new Date(timeStr);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day} ${h}:${min}`;
  };

  // 加载快照列表
  const loadHistories = useCallback(async () => {
    if (!noteId) return;
    try {
      setIsLoadingList(true);
      const res = await notesApi.getNoteHistories(noteId);
      const list = res?.data?.histories || [];
      setHistories(list);
    } catch (e: any) {
      Alert.alert('加载失败', e.message || '获取历史版本列表失败');
    } finally {
      setIsLoadingList(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (visible) {
      setViewStage('list');
      setSelectedHistory(null);
      setViewMode('diff');
      setBaselineMode('current');
      loadHistories();
    }
  }, [visible, loadHistories]);

  // 选择某版本进入对比详情
  const handleSelectHistory = async (item: NoteHistoryItem) => {
    setSelectedHistory(item);
    setViewStage('detail');

    if (!item.content) {
      try {
        setIsLoadingDetail(true);
        const res = await notesApi.getNoteHistoryDetail(noteId, item._id);
        if (res?.data?.history) {
          setSelectedHistory(res.data.history);
          setHistories(prev =>
            prev.map(h => (h._id === item._id ? { ...h, content: res.data.history.content } : h))
          );
        }
      } catch (e: any) {
        Alert.alert('获取详情失败', e.message || '无法获取快照完整内容');
      } finally {
        setIsLoadingDetail(false);
      }
    }
  };

  // 计算上一快照内容
  const previousHistoryContent = useMemo(() => {
    if (!selectedHistory) return '';
    const currentIndex = histories.findIndex(h => h._id === selectedHistory._id);
    if (currentIndex >= 0 && currentIndex < histories.length - 1) {
      return histories[currentIndex + 1].content || '';
    }
    return '';
  }, [selectedHistory, histories]);

  // 计算当前对比基准文本
  const baselineText = useMemo(() => {
    if (baselineMode === 'previous') {
      return previousHistoryContent;
    }
    return currentContent;
  }, [baselineMode, previousHistoryContent, currentContent]);

  const baselineTitle = baselineMode === 'previous' ? '上一快照' : '当前工作区';

  // 复制快照全文
  const handleCopyContent = async () => {
    if (!selectedHistory?.content) return;
    await Clipboard.setStringAsync(selectedHistory.content);
    if (Platform.OS === 'web') {
      window.alert('快照内容已成功复制至剪贴板');
    } else {
      Alert.alert('复制成功', '快照内容已复制至系统剪贴板');
    }
  };

  // 执行安全回滚
  const handleRollback = () => {
    if (!selectedHistory) return;

    const executeRollback = async () => {
      try {
        setIsRollingBack(true);
        const res = await notesApi.rollbackNoteHistory(noteId, selectedHistory._id);
        if (res.code === 200) {
          Alert.alert('恢复成功', '笔记已成功回滚至该历史版本');
          onRollbackSuccess?.(res.data.note);
          onClose();
        } else {
          throw new Error(res.message);
        }
      } catch (e: any) {
        Alert.alert('回滚失败', e.message || '网络连接异常');
      } finally {
        setIsRollingBack(false);
      }
    };

    Alert.alert(
      '恢复历史版本',
      '确定要恢复至此快照版本吗？若当前工作区有未保存的最新变动，服务端将自动为您生成安全备份快照。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定恢复',
          style: 'destructive',
          onPress: executeRollback,
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <View style={[styles.modalRoot, { paddingTop: topPadding, paddingBottom: insets.bottom }]}>
        {/* 顶部主导航栏 */}
        <View style={styles.navBar}>
          <View style={styles.navLeft}>
            {viewStage === 'detail' ? (
              <TouchableOpacity
                style={styles.navIconBtn}
                onPress={() => setViewStage('list')}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={22} color="#0f172a" />
              </TouchableOpacity>
            ) : (
              <View style={styles.navBrandCluster}>
                <Ionicons name="time-outline" size={20} color="#1890ff" />
                <Text style={styles.navTitle}>版本快照历史</Text>
              </View>
            )}

            {viewStage === 'detail' && (
              <View style={styles.navDetailTitleCluster}>
                <Text style={styles.navTitle} numberOfLines={1}>
                  快照详情
                </Text>
                {selectedHistory?.createdAt && (
                  <Text style={styles.navSubtitle}>
                    {formatTime(selectedHistory.createdAt)}
                  </Text>
                )}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.navIconBtn} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* 视图主体 */}
        {viewStage === 'list' ? (
          <View style={styles.listContainer}>
            {isLoadingList ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#1890ff" />
                <Text style={styles.loadingText}>正在获取历史版本快照...</Text>
              </View>
            ) : histories.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={44} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>暂无历史版本快照</Text>
                <Text style={styles.emptySubtitle}>
                  当您编辑并保存笔记时，系统将自动记录版本历史
                </Text>
              </View>
            ) : (
              <ScrollView
                style={styles.timelineScroll}
                contentContainerStyle={styles.timelineContent}
              >
                <View style={styles.listHeaderPrompt}>
                  <Text style={styles.promptText}>
                    共记录 {histories.length} 个历史快照，轻触任意版本即可查看对比与恢复
                  </Text>
                </View>

                {histories.map((item, idx) => {
                  const isLatest = idx === 0;
                  const saveTypeLabel =
                    item.saveType === 'auto'
                      ? '自动保存'
                      : item.saveType === 'rollback'
                      ? '安全备份'
                      : '手动保存';

                  return (
                    <TouchableOpacity
                      key={item._id}
                      style={styles.historyCard}
                      onPress={() => handleSelectHistory(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.cardHeader}>
                        <View style={styles.versionBadgeRow}>
                          <View
                            style={[
                              styles.versionPill,
                              isLatest && styles.versionPillLatest,
                            ]}
                          >
                            <Text
                              style={[
                                styles.versionPillText,
                                isLatest && styles.versionPillLatestText,
                              ]}
                            >
                              v{histories.length - idx}
                            </Text>
                          </View>

                          <View style={styles.saveTypeBadge}>
                            <Text style={styles.saveTypeBadgeText}>{saveTypeLabel}</Text>
                          </View>

                          {isLatest && (
                            <View style={styles.latestMarker}>
                              <Text style={styles.latestMarkerText}>最新</Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.cardTimeText}>
                          {formatTime(item.createdAt)}
                        </Text>
                      </View>

                      <View style={styles.cardBody}>
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {item.title || '无标题笔记'}
                        </Text>
                        <View style={styles.cardMetaRow}>
                          {item.wordCount !== undefined && (
                            <Text style={styles.cardMetaItem}>
                              字数：{item.wordCount}
                            </Text>
                          )}
                          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : (
          <View style={styles.detailContainer}>
            {/* 二级详情控制栏：三模态分段器 */}
            <View style={styles.modeTabBar}>
              <View style={styles.modeSegmented}>
                <TouchableOpacity
                  style={[styles.segmentBtn, viewMode === 'diff' && styles.segmentBtnActive]}
                  onPress={() => setViewMode('diff')}
                >
                  <Ionicons
                    name="git-compare-outline"
                    size={14}
                    color={viewMode === 'diff' ? '#1890ff' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.segmentBtnText,
                      viewMode === 'diff' && styles.segmentBtnTextActive,
                    ]}
                  >
                    差异对比
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, viewMode === 'preview' && styles.segmentBtnActive]}
                  onPress={() => setViewMode('preview')}
                >
                  <Ionicons
                    name="eye-outline"
                    size={14}
                    color={viewMode === 'preview' ? '#1890ff' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.segmentBtnText,
                      viewMode === 'preview' && styles.segmentBtnTextActive,
                    ]}
                  >
                    渲染预览
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segmentBtn, viewMode === 'raw' && styles.segmentBtnActive]}
                  onPress={() => setViewMode('raw')}
                >
                  <Ionicons
                    name="code-outline"
                    size={14}
                    color={viewMode === 'raw' ? '#1890ff' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.segmentBtnText,
                      viewMode === 'raw' && styles.segmentBtnTextActive,
                    ]}
                  >
                    纯文本
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Diff 专用工具栏：对比基准切换与布局切换 */}
            {viewMode === 'diff' && (
              <View style={styles.diffSubToolbar}>
                <View style={styles.baselineSwitchGroup}>
                  <Text style={styles.toolbarLabel}>基准：</Text>
                  <TouchableOpacity
                    style={[
                      styles.baselineBtn,
                      baselineMode === 'current' && styles.baselineBtnActive,
                    ]}
                    onPress={() => setBaselineMode('current')}
                  >
                    <Text
                      style={[
                        styles.baselineBtnText,
                        baselineMode === 'current' && styles.baselineBtnTextActive,
                      ]}
                    >
                      当前工作区
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.baselineBtn,
                      baselineMode === 'previous' && styles.baselineBtnActive,
                    ]}
                    onPress={() => setBaselineMode('previous')}
                  >
                    <Text
                      style={[
                        styles.baselineBtnText,
                        baselineMode === 'previous' && styles.baselineBtnTextActive,
                      ]}
                    >
                      上一快照
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Unified vs Split 紧凑切换 */}
                <TouchableOpacity
                  style={styles.layoutToggleBtn}
                  onPress={() =>
                    setDiffLayout(prev => (prev === 'unified' ? 'split' : 'unified'))
                  }
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={diffLayout === 'unified' ? 'list-outline' : 'grid-outline'}
                    size={13}
                    color="#475569"
                  />
                  <Text style={styles.layoutToggleText}>
                    {diffLayout === 'unified' ? '单列' : '并排'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 内容区 */}
            {isLoadingDetail ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#1890ff" />
                <Text style={styles.loadingText}>正在载入快照内容...</Text>
              </View>
            ) : viewMode === 'diff' ? (
              <DiffViewer
                oldValue={baselineText}
                newValue={selectedHistory?.content || ''}
                oldTitle={baselineTitle}
                newTitle="历史快照"
                layout={diffLayout}
              />
            ) : viewMode === 'preview' ? (
              <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
                <Text style={styles.previewTitle}>
                  {selectedHistory?.title || '无标题快照'}
                </Text>
                <Markdown>{selectedHistory?.content || '*快照内容为空*'}</Markdown>
              </ScrollView>
            ) : (
              <ScrollView style={styles.rawScroll} contentContainerStyle={styles.rawContent}>
                <Text selectable style={styles.rawText}>
                  {selectedHistory?.content || ''}
                </Text>
              </ScrollView>
            )}

            {/* 底部悬浮操作集群 */}
            <View style={styles.footerActionBar}>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopyContent}
                activeOpacity={0.7}
              >
                <Ionicons name="copy-outline" size={17} color="#0f172a" />
                <Text style={styles.copyBtnText}>复制内容</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rollbackBtn, isRollingBack && styles.rollbackBtnDisabled]}
                onPress={handleRollback}
                disabled={isRollingBack}
                activeOpacity={0.8}
              >
                {isRollingBack ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={17} color="#ffffff" />
                    <Text style={styles.rollbackBtnText}>恢复此版本</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  navBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  navLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  navBrandCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navDetailTitleCluster: {
    flex: 1,
  },
  navTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  navSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  navIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  listContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748b',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    padding: 16,
    gap: 12,
  },
  listHeaderPrompt: {
    marginBottom: 4,
  },
  promptText: {
    fontSize: 12,
    color: '#64748b',
  },
  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  versionBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  versionPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  versionPillLatest: {
    backgroundColor: '#eff6ff',
  },
  versionPillText: {
    fontSize: 12,
    fontFamily: MONO_FONT,
    fontWeight: '600',
    color: '#475569',
  },
  versionPillLatestText: {
    color: '#1890ff',
  },
  saveTypeBadge: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  saveTypeBadgeText: {
    fontSize: 11,
    color: '#64748b',
  },
  latestMarker: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  latestMarkerText: {
    fontSize: 10,
    color: '#059669',
    fontWeight: '600',
  },
  cardTimeText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
    flex: 1,
    marginRight: 12,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardMetaItem: {
    fontSize: 12,
    color: '#94a3b8',
  },
  detailContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  modeTabBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  modeSegmented: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 8,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    borderRadius: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
  },
  segmentBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  segmentBtnTextActive: {
    color: '#0f172a',
    fontWeight: '600',
  },
  diffSubToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  baselineSwitchGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolbarLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  baselineBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
  },
  baselineBtnActive: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  baselineBtnText: {
    fontSize: 11,
    color: '#64748b',
  },
  baselineBtnTextActive: {
    color: '#1890ff',
    fontWeight: '600',
  },
  layoutToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  layoutToggleText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  previewScroll: {
    flex: 1,
  },
  previewContent: {
    padding: 16,
  },
  previewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 14,
  },
  rawScroll: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  rawContent: {
    padding: 14,
  },
  rawText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 18,
    color: '#0f172a',
  },
  footerActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 12,
  },
  copyBtn: {
    flex: 1,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  copyBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#0f172a',
  },
  rollbackBtn: {
    flex: 1.5,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1890ff',
    borderRadius: 10,
  },
  rollbackBtnDisabled: {
    opacity: 0.6,
  },
  rollbackBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
