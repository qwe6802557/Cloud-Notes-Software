import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { streamAICall } from '../api/aiApi';

const DOC_ACTIONS = [
  { key: 'full_summary', icon: 'document-text-outline', label: '核心摘要', promptName: '全文核心摘要提炼' },
  { key: 'extract_todos', icon: 'checkbox-outline', label: '待办清单', promptName: '提取行动清单与待办事项' },
  { key: 'mindmap_outline', icon: 'git-network-outline', label: '导图大纲', promptName: '生成思维导图结构大纲' },
  { key: 'continue', icon: 'pencil-outline', label: '承接续写', promptName: '承接全文智能续写' },
  { key: 'custom', icon: 'chatbubble-ellipses-outline', label: '针对笔记提问', promptName: '针对全篇笔记对话提问' },
];

const SELECTION_ACTIONS = [
  { key: 'polish', icon: 'sparkles-outline', label: '智能润色', promptName: '智能润色文笔' },
  { key: 'continue', icon: 'arrow-forward-circle-outline', label: '承接续写', promptName: '承接选区内容续写' },
  { key: 'expand', icon: 'expand-outline', label: '丰富扩写', promptName: '丰富细节与扩写' },
  { key: 'summarize_text', icon: 'contract-outline', label: '精简提炼', promptName: '精简提炼核心观点' },
  { key: 'grammar', icon: 'checkmark-circle-outline', label: '纠错校对', promptName: '修正错别字与语法' },
  { key: 'translate_en', icon: 'globe-outline', label: '翻译英文', promptName: '翻译为地道英文' },
  { key: 'translate_zh', icon: 'language-outline', label: '翻译中文', promptName: '翻译为规范中文' },
  { key: 'custom', icon: 'chatbubbles-outline', label: '自定义指令', promptName: '自定义修改指令' },
];

export interface AIAssistantModalProps {
  visible: boolean;
  onClose: () => void;
  noteTitle?: string;
  noteContent?: string;
  selectedText?: string;
  isEditable?: boolean;
  initialAction?: string;
  onReplaceSelection?: (newText: string) => void;
  onInsertContent?: (newText: string) => void;
}

export default function AIAssistantModal({
  visible,
  onClose,
  noteTitle = '',
  noteContent = '',
  selectedText = '',
  isEditable = false,
  initialAction,
  onReplaceSelection,
  onInsertContent,
}: AIAssistantModalProps) {
  // 模式：'selection' (针对所选局部文本) 或 'doc' (针对整篇文档)
  const hasSelection = Boolean(selectedText && selectedText.trim());
  const [targetScope, setTargetScope] = useState<'doc' | 'selection'>(
    hasSelection ? 'selection' : 'doc'
  );

  const [currentAction, setCurrentAction] = useState<string>(
    initialAction || (hasSelection ? 'polish' : 'full_summary')
  );
  const [customPrompt, setCustomPrompt] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [resultText, setResultText] = useState('');
  const [copied, setCopied] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const resultScrollRef = useRef<ScrollView>(null);

  // 初始化与重置状态
  useEffect(() => {
    if (visible) {
      const initScope = hasSelection ? 'selection' : 'doc';
      const initAct = initialAction || (hasSelection ? 'polish' : 'full_summary');
      setTargetScope(initScope);
      setCurrentAction(initAct);
      setCustomPrompt('');
      setResultText('');
      setCopied(false);

      // 如果不是纯自定义提问，打开时自动开始流式生成
      if (initAct !== 'custom') {
        startStream(initAct, initScope, '');
      }
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setIsStreaming(false);
      setResultText('');
    }
  }, [visible, hasSelection, initialAction]);

  // 组件卸载时确保请求取消
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // 发起流式 SSE 创作请求
  const startStream = useCallback(
    async (
      act: string = currentAction,
      scope: 'doc' | 'selection' = targetScope,
      promptText: string = customPrompt
    ) => {
      const activeText = scope === 'selection' ? selectedText : noteContent;

      if (!activeText.trim() && !promptText.trim()) {
        Alert.alert('提示', '分析内容为空，请输入笔记内容或指令');
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      setResultText('');
      setCopied(false);

      try {
        await streamAICall(
          {
            action: act,
            text: activeText,
            noteTitle: noteTitle,
            customPrompt: promptText,
          },
          {
            signal: controller.signal,
            onDelta: (_delta, full) => {
              setResultText(full);
              resultScrollRef.current?.scrollToEnd({ animated: true });
            },
            onFinish: full => {
              setIsStreaming(false);
              setResultText(full);
            },
            onError: err => {
              if (err.name === 'AbortError') return;
              setIsStreaming(false);
              Alert.alert('AI 服务提示', err.message || '生成异常，请稍后重试');
            },
          }
        );
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        setIsStreaming(false);
      }
    },
    [currentAction, targetScope, customPrompt, selectedText, noteContent, noteTitle]
  );

  // 终止推流
  const handleStopStream = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsStreaming(false);
  };

  // 切换操作动作
  const handleSelectAction = (actKey: string) => {
    setCurrentAction(actKey);
    if (actKey !== 'custom') {
      startStream(actKey, targetScope, '');
    } else {
      setResultText('');
    }
  };

  // 切换分析范围（全文 vs 选区）
  const handleSwitchScope = (scope: 'doc' | 'selection') => {
    setTargetScope(scope);
    const newAct = scope === 'selection' ? 'polish' : 'full_summary';
    setCurrentAction(newAct);
    startStream(newAct, scope, '');
  };

  // 复制内容
  const handleCopy = async () => {
    if (!resultText) return;
    try {
      await Clipboard.setStringAsync(resultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      Alert.alert('复制成功', 'AI 创作内容已存入剪贴板');
    } catch {
      Alert.alert('内容', resultText);
    }
  };

  // 替换原文/选区
  const handleReplace = () => {
    if (!resultText || !onReplaceSelection) return;
    onReplaceSelection(resultText);
    Alert.alert('提示', targetScope === 'selection' ? '已替换所选文本' : '已替换全文内容');
    onClose();
  };

  // 插入到正文（光标后或文末）
  const handleInsert = () => {
    if (!resultText || !onInsertContent) return;
    let insertion = resultText;
    if (targetScope === 'doc') {
      let prefix = '\n\n';
      if (currentAction === 'full_summary') prefix += '## 📑 AI 核心摘要\n';
      else if (currentAction === 'extract_todos') prefix += '## ✅ 待办事项清单\n';
      else if (currentAction === 'mindmap_outline') prefix += '## 🧠 思维导图大纲\n';
      insertion = prefix + resultText;
    }
    onInsertContent(insertion);
    Alert.alert('提示', '已插入至文档');
    onClose();
  };

  const actionList = targetScope === 'selection' ? SELECTION_ACTIONS : DOC_ACTIONS;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        handleStopStream();
        onClose();
      }}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
        >
          <View style={styles.modalSheet}>
            {/* 顶部标题栏 */}
            <View style={styles.sheetHeader}>
              <View style={styles.headerTitleRow}>
                <View style={styles.headerIconBox}>
                  <Ionicons name="sparkles" size={18} color="#7c3aed" />
                </View>
                <Text style={styles.headerTitle}>AI 创作</Text>
                <View style={styles.modelBadge}>
                  <Text style={styles.modelBadgeText}>grok-chat-fast</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  handleStopStream();
                  onClose();
                }}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* 范围选择 Tab (全文 vs 选区) */}
            {hasSelection && (
              <View style={styles.scopeTabs}>
                <TouchableOpacity
                  style={[styles.scopeTabBtn, targetScope === 'selection' && styles.scopeTabBtnActive]}
                  onPress={() => handleSwitchScope('selection')}
                >
                  <Ionicons
                    name="text-outline"
                    size={14}
                    color={targetScope === 'selection' ? '#7c3aed' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.scopeTabText,
                      targetScope === 'selection' && styles.scopeTabTextActive,
                    ]}
                  >
                    针对选中文本
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.scopeTabBtn, targetScope === 'doc' && styles.scopeTabBtnActive]}
                  onPress={() => handleSwitchScope('doc')}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={14}
                    color={targetScope === 'doc' ? '#7c3aed' : '#64748b'}
                  />
                  <Text
                    style={[
                      styles.scopeTabText,
                      targetScope === 'doc' && styles.scopeTabTextActive,
                    ]}
                  >
                    针对整篇文档
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 功能快捷胶囊 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.actionsScroll}
              contentContainerStyle={styles.actionsContent}
            >
              {actionList.map(item => {
                const isActive = currentAction === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.actionChip, isActive && styles.actionChipActive]}
                    onPress={() => handleSelectAction(item.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={item.icon as any}
                      size={15}
                      color={isActive ? '#ffffff' : '#475569'}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.actionChipText, isActive && styles.actionChipTextActive]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 自定义提问/指令输入框 */}
            {currentAction === 'custom' && (
              <View style={styles.customInputRow}>
                <TextInput
                  style={styles.customInput}
                  placeholder={
                    targetScope === 'selection'
                      ? '输入针对所选文本的具体指令...'
                      : '针对全篇笔记输入您的问题或要求...'
                  }
                  placeholderTextColor="#94a3b8"
                  value={customPrompt}
                  onChangeText={setCustomPrompt}
                  onSubmitEditing={() => startStream('custom', targetScope, customPrompt)}
                />
                <TouchableOpacity
                  style={[
                    styles.customSendBtn,
                    (!customPrompt.trim() || isStreaming) && styles.customSendBtnDisabled,
                  ]}
                  onPress={() => startStream('custom', targetScope, customPrompt)}
                  disabled={!customPrompt.trim() || isStreaming}
                >
                  {isStreaming ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="send" size={16} color="#ffffff" />
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* 生成状态指示 */}
            <View style={styles.statusBar}>
              <View style={styles.statusLeft}>
                {isStreaming ? (
                  <>
                    <ActivityIndicator size="small" color="#7c3aed" style={{ marginRight: 6 }} />
                    <Text style={styles.statusStreamingText}>正在实时流式生成中...</Text>
                  </>
                ) : resultText ? (
                  <>
                    <Ionicons name="checkmark-circle" size={15} color="#10b981" style={{ marginRight: 4 }} />
                    <Text style={styles.statusDoneText}>生成完成</Text>
                  </>
                ) : (
                  <Text style={styles.statusIdleText}>选择上方功能即可一键智能创作</Text>
                )}
              </View>

              {isStreaming && (
                <TouchableOpacity style={styles.stopBtn} onPress={handleStopStream}>
                  <Ionicons name="stop-circle-outline" size={16} color="#ef4444" style={{ marginRight: 3 }} />
                  <Text style={styles.stopBtnText}>停止</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* AI 结果呈现区域 */}
            <ScrollView
              ref={resultScrollRef}
              style={styles.resultScroll}
              contentContainerStyle={styles.resultScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {resultText ? (
                <Markdown
                  style={{
                    body: { color: '#1e293b', fontSize: 14, lineHeight: 22 },
                    heading1: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#0f172a' },
                    heading2: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: '#0f172a' },
                    bullet_list: { marginVertical: 4 },
                    code_block: { backgroundColor: '#f1f5f9', padding: 8, borderRadius: 6 },
                  }}
                >
                  {resultText}
                </Markdown>
              ) : isStreaming ? (
                <View style={styles.emptyCenter}>
                  <ActivityIndicator size="large" color="#7c3aed" />
                  <Text style={styles.emptyThinkingText}>AI 正在组织思路中...</Text>
                </View>
              ) : (
                <View style={styles.emptyCenter}>
                  <Ionicons name="sparkles-outline" size={36} color="#cbd5e1" />
                  <Text style={styles.emptyPlaceholderText}>
                    {currentAction === 'custom'
                      ? '在上方输入指令后点击发送开始'
                      : '点击上方选项生成核心摘要、行动清单或进行文笔润色'}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* 底部操作工具行 */}
            {Boolean(resultText) && (
              <View style={styles.footerRow}>
                <TouchableOpacity
                  style={styles.footerActionBtn}
                  onPress={handleCopy}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={16}
                    color="#475569"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.footerActionText}>{copied ? '已复制' : '复制'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.footerActionBtn}
                  onPress={() => startStream(currentAction, targetScope, customPrompt)}
                  activeOpacity={0.7}
                  disabled={isStreaming}
                >
                  <Ionicons name="refresh-outline" size={16} color="#475569" style={{ marginRight: 4 }} />
                  <Text style={styles.footerActionText}>重试</Text>
                </TouchableOpacity>

                {isEditable && onInsertContent && (
                  <TouchableOpacity
                    style={[styles.footerActionBtn, styles.insertBtn]}
                    onPress={handleInsert}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="arrow-down-outline" size={16} color="#2563eb" style={{ marginRight: 4 }} />
                    <Text style={[styles.footerActionText, { color: '#2563eb' }]}>插入正文</Text>
                  </TouchableOpacity>
                )}

                {isEditable && onReplaceSelection && (
                  <TouchableOpacity
                    style={[styles.footerActionBtn, styles.replaceBtn]}
                    onPress={handleReplace}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="swap-horizontal-outline" size={16} color="#ffffff" style={{ marginRight: 4 }} />
                    <Text style={[styles.footerActionText, { color: '#ffffff', fontWeight: '600' }]}>
                      {targetScope === 'selection' ? '替换选区' : '替换全文'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const screenHeight = Dimensions.get('window').height;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  keyboardContainer: {
    width: '100%',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: screenHeight * 0.88,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#f5f3ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  modelBadge: {
    backgroundColor: '#f5f3ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e9d5ff',
  },
  modelBadgeText: {
    fontSize: 11,
    color: '#7c3aed',
    fontWeight: '600',
  },
  closeBtn: {
    padding: 4,
  },
  scopeTabs: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 8,
    padding: 3,
    gap: 4,
  },
  scopeTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    gap: 6,
  },
  scopeTabBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 1,
  },
  scopeTabText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  scopeTabTextActive: {
    color: '#7c3aed',
    fontWeight: '700',
  },
  actionsScroll: {
    marginTop: 10,
    maxHeight: 38,
  },
  actionsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  actionChipActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
  },
  actionChipTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  customInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  customInput: {
    flex: 1,
    height: 40,
    fontSize: 13,
    color: '#0f172a',
  },
  customSendBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customSendBtnDisabled: {
    backgroundColor: '#cbd5e1',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusStreamingText: {
    fontSize: 12,
    color: '#7c3aed',
    fontWeight: '500',
  },
  statusDoneText: {
    fontSize: 12,
    color: '#10b981',
    fontWeight: '500',
  },
  statusIdleText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#fef2f2',
  },
  stopBtnText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
  resultScroll: {
    backgroundColor: '#f8fafc',
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 180,
    maxHeight: 280,
  },
  resultScrollContent: {
    padding: 14,
  },
  emptyCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    gap: 10,
  },
  emptyThinkingText: {
    fontSize: 13,
    color: '#7c3aed',
  },
  emptyPlaceholderText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  footerActionText: {
    fontSize: 13,
    color: '#334155',
  },
  insertBtn: {
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
  },
  replaceBtn: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
});
