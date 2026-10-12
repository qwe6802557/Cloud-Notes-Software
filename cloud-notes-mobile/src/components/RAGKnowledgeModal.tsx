import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import {
  CitationItem,
  getRAGStats,
  RAGStats,
  streamRAGChat,
  triggerRAGReindex,
} from '../api/ragApi';

export interface RAGKnowledgeModalProps {
  visible: boolean;
  onClose: () => void;
  currentNoteId?: string;
  currentNoteTitle?: string;
  currentNotebookId?: string;
  currentNotebookName?: string;
  onNavigateNote?: (noteId: string) => void;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationItem[];
  isStreaming?: boolean;
}

type ScopeType = 'all' | 'notebook' | 'note';

export default function RAGKnowledgeModal({
  visible,
  onClose,
  currentNoteId,
  currentNoteTitle,
  currentNotebookId,
  currentNotebookName,
  onNavigateNote,
}: RAGKnowledgeModalProps) {
  const router = useRouter();

  const [scope, setScope] = useState<ScopeType>('all');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<RAGStats | null>(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const [expandedCitationMsgId, setExpandedCitationMsgId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await getRAGStats();
      if (res.code === 200 && res.data) {
        setStats(res.data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) {
      loadStats();
      if (currentNoteId) {
        setScope('note');
      } else if (currentNotebookId) {
        setScope('notebook');
      } else {
        setScope('all');
      }
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsStreaming(false);
    }
  }, [visible, currentNoteId, currentNotebookId, loadStats]);

  const handleReindex = async () => {
    if (isReindexing) return;
    setIsReindexing(true);
    try {
      const res = await triggerRAGReindex();
      if (res.code === 200) {
        await loadStats();
      }
    } catch (e: any) {
      Alert.alert('重建失败', e.message || '网络连接超时');
    } finally {
      setIsReindexing(false);
    }
  };

  const handleStopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  };

  const handleSendMessage = async () => {
    const question = inputText.trim();
    if (!question || isStreaming) return;

    setInputText('');

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: question,
    };

    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      citations: [],
      isStreaming: true,
    };

    const nextHistory = [...messages, userMsg];
    setMessages([...nextHistory, assistantMsg]);
    setIsStreaming(true);

    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    const scopePayload = {
      type: scope,
      notebookId: scope === 'notebook' ? currentNotebookId : undefined,
      noteId: scope === 'note' ? currentNoteId : undefined,
    };

    const historyPayload = nextHistory.slice(-6).map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      await streamRAGChat(
        {
          question,
          scope: scopePayload,
          history: historyPayload,
        },
        {
          signal: abortCtrl.signal,
          onMeta: meta => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId ? { ...m, citations: meta.citations || [] } : m
              )
            );
            if (meta.citations && meta.citations.length > 0) {
              setExpandedCitationMsgId(assistantMsgId);
            }
          },
          onDelta: (_delta, fullText) => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId ? { ...m, content: fullText } : m
              )
            );
          },
          onFinish: fullText => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: fullText, isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            abortControllerRef.current = null;
          },
          onError: err => {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content || `问答请求失败: ${err.message}`,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            abortControllerRef.current = null;
          },
        }
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content || `请求发生异常: ${e.message}`,
                  isStreaming: false,
                }
              : m
          )
        );
      }
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleNavigateToNote = (targetNoteId: string) => {
    onClose();
    if (onNavigateNote) {
      onNavigateNote(targetNoteId);
    } else {
      router.push({
        pathname: '/note/[id]',
        params: { id: targetNoteId },
      });
    }
  };

  const handleCopyContent = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('提示', '已复制回答内容到剪贴板');
  };

  const handleClearHistory = () => {
    if (isStreaming) return;
    setMessages([]);
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    const isExpanded = expandedCitationMsgId === item.id;

    if (isUser) {
      return (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.assistantRow}>
        <View style={styles.assistantAvatar}>
          <Ionicons name="hardware-chip-outline" size={16} color="#2563eb" />
        </View>

        <View style={styles.assistantContentBox}>
          <View style={styles.assistantBubble}>
            {item.content ? (
              <Markdown
                style={{
                  body: { color: '#0f172a', fontSize: 14, lineHeight: 22 },
                  heading1: { fontSize: 17, fontWeight: '700', marginVertical: 6, color: '#0f172a' },
                  heading2: { fontSize: 15, fontWeight: '600', marginVertical: 4, color: '#0f172a' },
                  bullet_list: { marginVertical: 4 },
                  code_block: { backgroundColor: '#f1f5f9', padding: 8, borderRadius: 6, fontSize: 12 },
                  link: { color: '#2563eb', textDecorationLine: 'none' },
                }}
              >
                {item.content}
              </Markdown>
            ) : item.isStreaming ? (
              <View style={styles.thinkingRow}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={styles.thinkingText}>正在检索知识库并推理中...</Text>
              </View>
            ) : null}

            {Boolean(item.content) && !item.isStreaming && (
              <View style={styles.msgFooter}>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => handleCopyContent(item.content)}
                >
                  <Ionicons name="copy-outline" size={13} color="#64748b" />
                  <Text style={styles.copyBtnText}>复制回答</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* 引用来源切片卡片 */}
          {item.citations && item.citations.length > 0 && (
            <View style={styles.citationsContainer}>
              <TouchableOpacity
                style={styles.citationToggleBar}
                onPress={() => setExpandedCitationMsgId(isExpanded ? null : item.id)}
                activeOpacity={0.7}
              >
                <View style={styles.citationToggleLeft}>
                  <Ionicons name="document-text-outline" size={14} color="#2563eb" />
                  <Text style={styles.citationToggleText}>
                    参考来源片段 ({item.citations.length})
                  </Text>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color="#64748b"
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.citationsList}>
                  {item.citations.map(c => (
                    <TouchableOpacity
                      key={`${c.noteId}-${c.citationIndex}`}
                      style={styles.citationCard}
                      onPress={() => handleNavigateToNote(c.noteId)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.citationCardHeader}>
                        <View style={styles.citationIndexBadge}>
                          <Text style={styles.citationIndexText}>[{c.citationIndex}]</Text>
                        </View>
                        <Text style={styles.citationTitle} numberOfLines={1}>
                          《{c.noteTitle}》
                        </Text>
                        {c.similarity !== undefined && (
                          <Text style={styles.citationSim}>
                            相关度 {Math.round(c.similarity * 100)}%
                          </Text>
                        )}
                      </View>
                      {Boolean(c.headerPath) && (
                        <Text style={styles.citationPath} numberOfLines={1}>
                          {c.headerPath}
                        </Text>
                      )}
                      <Text style={styles.citationSnippet} numberOfLines={2}>
                        {c.snippet}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          style={styles.sheetContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* 顶部标题栏 */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="library-outline" size={20} color="#2563eb" style={{ marginRight: 6 }} />
              <Text style={styles.headerTitle}>知识库问答</Text>
            </View>

            <View style={styles.headerRight}>
              {messages.length > 0 && !isStreaming && (
                <TouchableOpacity
                  style={styles.headerIconBtn}
                  onPress={handleClearHistory}
                >
                  <Ionicons name="trash-outline" size={18} color="#64748b" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.headerIconBtn} onPress={onClose}>
                <Ionicons name="close" size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>
          </View>

          {/* 检索范围与索引状态栏 */}
          <View style={styles.scopeBar}>
            <View style={styles.scopePills}>
              <TouchableOpacity
                style={[styles.scopePill, scope === 'all' && styles.scopePillActive]}
                onPress={() => setScope('all')}
              >
                <Text style={[styles.scopePillText, scope === 'all' && styles.scopePillTextActive]}>
                  全库检索
                </Text>
              </TouchableOpacity>

              {Boolean(currentNotebookId) && (
                <TouchableOpacity
                  style={[styles.scopePill, scope === 'notebook' && styles.scopePillActive]}
                  onPress={() => setScope('notebook')}
                >
                  <Text
                    style={[
                      styles.scopePillText,
                      scope === 'notebook' && styles.scopePillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    本笔记本
                  </Text>
                </TouchableOpacity>
              )}

              {Boolean(currentNoteId) && (
                <TouchableOpacity
                  style={[styles.scopePill, scope === 'note' && styles.scopePillActive]}
                  onPress={() => setScope('note')}
                >
                  <Text
                    style={[
                      styles.scopePillText,
                      scope === 'note' && styles.scopePillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    仅当前篇
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={styles.reindexBtn}
              onPress={handleReindex}
              disabled={isReindexing}
            >
              {isReindexing ? (
                <ActivityIndicator size="small" color="#2563eb" style={{ marginRight: 4 }} />
              ) : (
                <Ionicons name="sync-outline" size={13} color="#2563eb" style={{ marginRight: 4 }} />
              )}
              <Text style={styles.reindexText}>
                {isReindexing
                  ? '索引中...'
                  : stats
                  ? `${stats.indexedNotes}篇 / ${stats.totalChunks}切片`
                  : '同步全库'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 对话消息展示列表 */}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <Ionicons name="bulb-outline" size={40} color="#cbd5e1" />
                <Text style={styles.emptyTitle}>基于个人笔记的 RAG 知识库问答</Text>
                <Text style={styles.emptyDesc}>
                  AI 将深度检索您的笔记片段，给出严谨可溯源的回答，并附带引用来源卡片。
                </Text>
              </View>
            }
          />

          {/* 底部输入框 */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="向个人知识库提问任何问题..."
              placeholderTextColor="#94a3b8"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={500}
            />

            {isStreaming ? (
              <TouchableOpacity
                style={styles.stopBtn}
                onPress={handleStopStream}
                activeOpacity={0.8}
              >
                <Ionicons name="stop-circle" size={18} color="#ef4444" />
                <Text style={styles.stopBtnText}>停止</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  !inputText.trim() && styles.sendBtnDisabled,
                ]}
                onPress={handleSendMessage}
                disabled={!inputText.trim()}
                activeOpacity={0.8}
              >
                <Ionicons name="arrow-up" size={18} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    height: SCREEN_HEIGHT * 0.88,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    height: 52,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBtn: {
    padding: 4,
  },
  scopeBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scopePills: {
    flexDirection: 'row',
    gap: 6,
  },
  scopePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  scopePillActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#93c5fd',
  },
  scopePillText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  scopePillTextActive: {
    color: '#1d4ed8',
    fontWeight: '600',
  },
  reindexBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#eff6ff',
  },
  reindexText: {
    fontSize: 11,
    color: '#2563eb',
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    marginTop: 12,
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 16,
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: '#0f172a',
    borderRadius: 14,
    borderBottomRightRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  assistantRow: {
    flexDirection: 'row',
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  assistantAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  assistantContentBox: {
    flex: 1,
  },
  assistantBubble: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderTopLeftRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  thinkingText: {
    fontSize: 13,
    color: '#64748b',
  },
  msgFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 6,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  copyBtnText: {
    fontSize: 11,
    color: '#64748b',
  },
  citationsContainer: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  citationToggleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
  },
  citationToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  citationToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  citationsList: {
    padding: 8,
    gap: 8,
  },
  citationCard: {
    padding: 8,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  citationCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  citationIndexBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    backgroundColor: '#eff6ff',
  },
  citationIndexText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  citationTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  citationSim: {
    fontSize: 10,
    color: '#64748b',
  },
  citationPath: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 2,
  },
  citationSnippet: {
    fontSize: 11,
    color: '#475569',
    lineHeight: 16,
  },
  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0f172a',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#cbd5e1',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fee2e2',
  },
  stopBtnText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
});
