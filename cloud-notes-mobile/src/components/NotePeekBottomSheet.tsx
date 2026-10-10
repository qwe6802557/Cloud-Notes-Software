import React, { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import * as notesApi from '../api/notesApi';
import { Note } from '../api/types';

interface NotePeekBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  targetTitle?: string;
  targetNoteId?: string;
  onOpenFullNote: (noteId: string) => void;
  onCreateAndEdit?: (title: string) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function NotePeekBottomSheet({
  visible,
  onClose,
  targetTitle = '',
  targetNoteId,
  onOpenFullNote,
  onCreateAndEdit,
}: NotePeekBottomSheetProps) {
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!visible) {
      setNote(null);
      setNotFound(false);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setNotFound(false);

    const loadData = async () => {
      try {
        if (targetNoteId) {
          const res = await notesApi.getNoteDetail(targetNoteId);
          if (!isMounted) return;
          const noteData = res?.data;
          if (noteData) {
            setNote(noteData);
            setNotFound(false);
          } else {
            setNotFound(true);
          }
        } else if (targetTitle) {
          const res = await notesApi.suggestNoteLinks(targetTitle);
          if (!isMounted) return;
          const list = res?.data?.suggestions || [];
          const match = list.find(
            (n: any) => n.title?.trim().toLowerCase() === targetTitle.trim().toLowerCase()
          );

          if (match?._id) {
            // 获取完整详情
            const detailRes = await notesApi.getNoteDetail(match._id);
            if (!isMounted) return;
            const fullNote = detailRes?.data || match;
            setNote(fullNote);
            setNotFound(false);
          } else {
            setNotFound(true);
          }
        }
      } catch {
        if (isMounted) setNotFound(true);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [visible, targetNoteId, targetTitle]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const displayTitle = note?.title || targetTitle || '笔记预览';
  const notebookName = note?.notebook?.name || note?.notebookId?.name || (note?.notebookId ? '已归档笔记本' : '默认笔记本');
  const notebookColor = note?.notebook?.color || note?.notebookId?.color || '#3b82f6';
  const previewContent = useMemo(() => {
    const raw = note?.content || note?.rawContent || '';
    if (!raw.trim()) return '_此笔记正文为空白_';
    // 截取前 2500 字符，兼顾快速预览与性能
    return raw.length > 2500 ? `${raw.slice(0, 2500)}\n\n_...（正文已截断，点击下方进入全文阅读）_` : raw;
  }, [note?.content, note?.rawContent]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.sheetContainer}>
              {/* 顶部指示条 */}
              <View style={styles.dragHandle} />

              {/* 头部信息 */}
              <View style={styles.headerRow}>
                <View style={styles.headerTitleWrap}>
                  <Ionicons name="document-text" size={17} color="#2563eb" style={{ marginRight: 6 }} />
                  <Text style={styles.headerTitle} numberOfLines={1} selectable>
                    {displayTitle}
                  </Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                  <Ionicons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* 元信息徽标栏 */}
              {!loading && !notFound && note && (
                <View style={styles.metaRow}>
                  <View style={[styles.notebookBadge, { borderColor: `${notebookColor}40`, backgroundColor: `${notebookColor}15` }]}>
                    <View style={[styles.colorDot, { backgroundColor: notebookColor }]} />
                    <Text style={[styles.notebookText, { color: notebookColor }]}>
                      {notebookName}
                    </Text>
                  </View>
                  <View style={styles.timeWrap}>
                    <Ionicons name="time-outline" size={12} color="#94a3b8" style={{ marginRight: 3 }} />
                    <Text style={styles.timeText}>
                      更新于 {formatDate(note.updatedAt || note.createdAt)}
                    </Text>
                  </View>
                </View>
              )}

              {/* 主体内容预览 */}
              <View style={styles.bodyContainer}>
                {loading ? (
                  <View style={styles.centerBox}>
                    <ActivityIndicator size="small" color="#2563eb" />
                    <Text style={styles.loadingText}>正在载入笔记快照...</Text>
                  </View>
                ) : notFound ? (
                  <View style={styles.notFoundBox}>
                    <View style={styles.notFoundTag}>
                      <Ionicons name="alert-circle-outline" size={14} color="#ea580c" style={{ marginRight: 4 }} />
                      <Text style={styles.notFoundTagText}>未创建双链笔记</Text>
                    </View>
                    <Text style={styles.notFoundDesc}>
                      知识库中尚未存在名为《{targetTitle}》的笔记。你可以立即以此标题创建新笔记，构建网状双向链接。
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.scrollArea}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={true}
                  >
                    <Markdown style={peekMarkdownStyles}>
                      {previewContent}
                    </Markdown>
                  </ScrollView>
                )}
              </View>

              {/* 底部操作工具栏 */}
              <View style={styles.footerBar}>
                {note?._id ? (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => {
                      onClose();
                      onOpenFullNote(note._id);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="open-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.primaryBtnText}>进入全文阅读 / 编辑</Text>
                  </TouchableOpacity>
                ) : notFound ? (
                  <TouchableOpacity
                    style={[styles.primaryBtn, styles.createBtn]}
                    onPress={() => {
                      onClose();
                      onCreateAndEdit?.(targetTitle);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add-circle-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.primaryBtnText}>立即创建并编辑</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const peekMarkdownStyles = {
  body: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 22,
  },
  paragraph: {
    marginVertical: 4,
  },
  heading1: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#0f172a',
    marginVertical: 6,
  },
  heading2: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: '#0f172a',
    marginVertical: 5,
  },
  heading3: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1e293b',
    marginVertical: 4,
  },
  code_inline: {
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 12,
  },
  code_block: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    marginVertical: 6,
  },
  fence: {
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 6,
    padding: 8,
    fontSize: 12,
    marginVertical: 6,
  },
  blockquote: {
    backgroundColor: '#f8fafc',
    borderLeftColor: '#3b82f6',
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 2,
    marginVertical: 6,
    color: '#64748b',
  },
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingHorizontal: 16,
    maxHeight: SCREEN_HEIGHT * 0.72,
    minHeight: 240,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 16.5,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 8,
  },
  notebookBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  colorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  notebookText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  timeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  bodyContainer: {
    flexShrink: 1,
    minHeight: 120,
    maxHeight: SCREEN_HEIGHT * 0.46,
    marginVertical: 6,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12.5,
    color: '#64748b',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  notFoundBox: {
    padding: 14,
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffedd5',
    marginVertical: 12,
  },
  notFoundTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  notFoundTagText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#ea580c',
  },
  notFoundDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: '#9a3412',
  },
  footerBar: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  createBtn: {
    backgroundColor: '#ea580c',
    shadowColor: '#ea580c',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14.5,
    fontWeight: '600',
  },
});
