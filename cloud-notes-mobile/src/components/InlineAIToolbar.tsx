import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface InlineAIActionItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
}

export const SELECTION_AI_ACTIONS: InlineAIActionItem[] = [
  { key: 'polish', label: '润色', icon: 'sparkles-outline', color: '#7c3aed' },
  { key: 'expand', label: '扩写', icon: 'expand-outline', color: '#2563eb' },
  { key: 'summarize_text', label: '精简', icon: 'contract-outline', color: '#059669' },
  { key: 'grammar', label: '纠错', icon: 'checkmark-circle-outline', color: '#0d9488' },
  { key: 'continue', label: '续写', icon: 'arrow-forward-circle-outline', color: '#d97706' },
  { key: 'custom', label: '指令', icon: 'chatbubbles-outline', color: '#6366f1' },
];

export const CURSOR_AI_ACTIONS: InlineAIActionItem[] = [
  { key: 'continue', label: '承接续写', icon: 'pencil-outline', color: '#7c3aed' },
  { key: 'full_summary', label: '全文摘要', icon: 'document-text-outline', color: '#2563eb' },
  { key: 'extract_todos', label: '提取待办', icon: 'checkbox-outline', color: '#059669' },
  { key: 'custom', label: '自由起草', icon: 'chatbubble-ellipses-outline', color: '#6366f1' },
];

export interface InlineAIToolbarProps {
  hasSelection: boolean;
  selectedTextLength: number;
  isGenerating?: boolean;
  isUploadingImage?: boolean;
  onInsertMarkdown: (prefix: string, suffix?: string) => void;
  onPickImage: () => void;
  onOpenFullAIModal: () => void;
  onTriggerAIAction: (actionKey: string, customPrompt?: string) => void;
  onTriggerWikiLink?: () => void;
}

export default function InlineAIToolbar({
  hasSelection,
  selectedTextLength,
  isGenerating = false,
  isUploadingImage = false,
  onInsertMarkdown,
  onPickImage,
  onOpenFullAIModal,
  onTriggerAIAction,
  onTriggerWikiLink,
}: InlineAIToolbarProps) {
  // 当处于选区时，用户可手动切回常规 Markdown 格式工具；重新选词时自动重置
  const [preferMarkdownInSelection, setPreferMarkdownInSelection] = useState(false);
  // 光标态下是否展开行内 AI 快捷选项
  const [showCursorAIMenu, setShowCursorAIMenu] = useState(false);
  // 是否正在输入自定义指令
  const [isInputtingCustomPrompt, setIsInputtingCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  const isSelectionMode = hasSelection && !preferMarkdownInSelection;

  const handleActionClick = (actionKey: string) => {
    if (actionKey === 'custom') {
      setIsInputtingCustomPrompt(true);
      return;
    }
    onTriggerAIAction(actionKey);
  };

  const handleSendCustomPrompt = () => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    setIsInputtingCustomPrompt(false);
    setCustomPrompt('');
    onTriggerAIAction('custom', trimmed);
  };

  return (
    <View style={styles.container}>
      {/* 自定义指令输入行 */}
      {isInputtingCustomPrompt && (
        <View style={styles.customPromptRow}>
          <TextInput
            style={styles.customPromptInput}
            placeholder={isSelectionMode ? '输入对所选内容的改写要求...' : '输入起草或生成主题...'}
            placeholderTextColor="#94a3b8"
            value={customPrompt}
            onChangeText={setCustomPrompt}
            autoFocus
            onSubmitEditing={handleSendCustomPrompt}
            returnKeyType="send"
          />
          <TouchableOpacity
            style={[styles.customPromptBtn, !customPrompt.trim() && styles.customPromptBtnDisabled]}
            onPress={handleSendCustomPrompt}
            disabled={!customPrompt.trim()}
            activeOpacity={0.7}
          >
            <Ionicons name="sparkles" size={15} color="#ffffff" />
            <Text style={styles.customPromptBtnText}>发送</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.customPromptCancelBtn}
            onPress={() => {
              setIsInputtingCustomPrompt(false);
              setCustomPrompt('');
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={18} color="#64748b" />
          </TouchableOpacity>
        </View>
      )}

      {/* 主工具栏 */}
      <View style={styles.toolbarBar}>
        {isSelectionMode ? (
          // ==================== 选区 AI 沉浸胶囊条 ====================
          <View style={styles.selectionToolbar}>
            {/* 选区计数指示 */}
            <View style={styles.selectionBadge}>
              <Ionicons name="sparkles" size={13} color="#7c3aed" />
              <Text style={styles.selectionBadgeText}>已选 {selectedTextLength} 字</Text>
            </View>

            {/* 动作横向列表 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actionScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {SELECTION_AI_ACTIONS.map(action => (
                <TouchableOpacity
                  key={action.key}
                  style={styles.actionChip}
                  onPress={() => handleActionClick(action.key)}
                  disabled={isGenerating}
                  activeOpacity={0.7}
                >
                  <Ionicons name={action.icon} size={15} color={action.color || '#7c3aed'} />
                  <Text style={[styles.actionChipText, { color: action.color || '#7c3aed' }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* 切回 Markdown 格式工具按钮 */}
            <TouchableOpacity
              style={styles.modeSwitchBtn}
              onPress={() => setPreferMarkdownInSelection(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="text-outline" size={16} color="#64748b" />
            </TouchableOpacity>
          </View>
        ) : showCursorAIMenu ? (
          // ==================== 光标态 AI 灵感胶囊条 ====================
          <View style={styles.selectionToolbar}>
            <TouchableOpacity
              style={styles.backToMarkdownBtn}
              onPress={() => setShowCursorAIMenu(false)}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={16} color="#64748b" />
              <Text style={styles.backToMarkdownText}>工具</Text>
            </TouchableOpacity>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.actionScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {CURSOR_AI_ACTIONS.map(action => (
                <TouchableOpacity
                  key={action.key}
                  style={styles.actionChip}
                  onPress={() => handleActionClick(action.key)}
                  disabled={isGenerating}
                  activeOpacity={0.7}
                >
                  <Ionicons name={action.icon} size={15} color={action.color || '#7c3aed'} />
                  <Text style={[styles.actionChipText, { color: action.color || '#7c3aed' }]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.fullModalEntryBtn}
              onPress={onOpenFullAIModal}
              activeOpacity={0.7}
            >
              <Ionicons name="expand-outline" size={15} color="#7c3aed" />
            </TouchableOpacity>
          </View>
        ) : (
          // ==================== 常规 Markdown + AI 入口工具栏 ====================
          <View style={styles.defaultToolbar}>
            {/* 左侧功能区：行内 AI、相册上传 */}
            <View style={styles.leftActions}>
              <TouchableOpacity
                style={styles.aiTriggerBtn}
                onPress={() => setShowCursorAIMenu(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="sparkles" size={15} color="#7c3aed" />
                <Text style={styles.aiTriggerBtnText}>AI</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.iconToolBtn}
                onPress={onPickImage}
                disabled={isUploadingImage}
                activeOpacity={0.7}
              >
                {isUploadingImage ? (
                  <ActivityIndicator size="small" color="#1890ff" />
                ) : (
                  <Ionicons name="image-outline" size={19} color="#1890ff" />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.toolbarDivider} />

            {/* Markdown 格式列表 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.markdownScroll}
              contentContainerStyle={styles.markdownContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* 双链快捷按钮 */}
              <TouchableOpacity
                style={[styles.mdBtn, styles.wikiLinkBtn]}
                onPress={onTriggerWikiLink ? onTriggerWikiLink : () => onInsertMarkdown('[[', ']]')}
                activeOpacity={0.7}
              >
                <Text style={styles.wikiLinkBtnText}>[[ ]]</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('## ')}>
                <Text style={styles.mdBtnText}>H2</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('### ')}>
                <Text style={styles.mdBtnText}>H3</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('**', '**')}>
                <Ionicons name="text" size={17} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('- ')}>
                <Ionicons name="list" size={17} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('- [ ] ')}>
                <Ionicons name="checkbox-outline" size={17} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('> ')}>
                <Ionicons name="chatbox-ellipses-outline" size={17} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('`', '`')}>
                <Ionicons name="code-slash" size={17} color="#0f172a" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.mdBtn} onPress={() => onInsertMarkdown('```\n', '\n```')}>
                <Ionicons name="terminal-outline" size={17} color="#0f172a" />
              </TouchableOpacity>
            </ScrollView>

            {/* 若当前处于选区却切到了 Markdown，提供切回选区 AI 的按钮 */}
            {hasSelection && preferMarkdownInSelection && (
              <TouchableOpacity
                style={styles.backToSelectionAIBtn}
                onPress={() => setPreferMarkdownInSelection(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="sparkles" size={15} color="#7c3aed" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  customPromptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#faf5ff',
    borderBottomWidth: 1,
    borderBottomColor: '#f3e8ff',
    gap: 8,
  },
  customPromptInput: {
    flex: 1,
    height: 36,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e9d5ff',
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#1e293b',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  customPromptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#7c3aed',
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
  },
  customPromptBtnDisabled: {
    opacity: 0.5,
  },
  customPromptBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  customPromptCancelBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  selectionToolbar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f3e8ff',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
  },
  selectionBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
  },
  actionScrollContent: {
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modeSwitchBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  backToMarkdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
  },
  backToMarkdownText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
    marginLeft: 2,
  },
  fullModalEntryBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#faf5ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  defaultToolbar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  aiTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f3e8ff',
    paddingHorizontal: 9,
    height: 34,
    borderRadius: 8,
  },
  aiTriggerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7c3aed',
  },
  iconToolBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
  },
  toolbarDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 8,
  },
  markdownScroll: {
    flex: 1,
  },
  markdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mdBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  mdBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  wikiLinkBtn: {
    width: 38,
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  wikiLinkBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  backToSelectionAIBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#f3e8ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
});
