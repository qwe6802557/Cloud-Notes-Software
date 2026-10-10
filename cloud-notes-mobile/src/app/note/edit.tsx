import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as notesApi from '../../api/notesApi';
import { streamAICall } from '../../api/aiApi';
import { Config } from '../../constants/Config';
import AIAssistantModal from '../../components/AIAssistantModal';
import VersionHistoryModal from '../../components/VersionHistoryModal';
import InlineAIToolbar from '../../components/InlineAIToolbar';
import InlineAIStreamCard from '../../components/InlineAIStreamCard';
import LinkSuggestBar from '../../components/LinkSuggestBar';

export default function NoteEditScreen() {
  const router = useRouter();
  const { id, notebookId: initialNotebookId, parentId: initialParentId } = useLocalSearchParams<{
    id?: string;
    notebookId?: string;
    parentId?: string;
  }>();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [notebookId, setNotebookId] = useState<string>(initialNotebookId || '');
  const [isLoading, setIsLoading] = useState(!!id);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [cursorPosition, setCursorPosition] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  const [showAIModal, setShowAIModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // 行内 AI 状态
  const [inlineCardVisible, setInlineCardVisible] = useState(false);
  const [inlineActionName, setInlineActionName] = useState('');
  const [inlineIsStreaming, setInlineIsStreaming] = useState(false);
  const [inlineStreamingText, setInlineStreamingText] = useState('');
  const [inlineErrorMessage, setInlineErrorMessage] = useState('');
  const [inlineSelectionSnapshot, setInlineSelectionSnapshot] = useState<{ start: number; end: number } | null>(null);
  const [lastInlineParams, setLastInlineParams] = useState<{ action: string; text?: string; noteTitle?: string; customPrompt?: string } | null>(null);

  const inlineAbortControllerRef = useRef<AbortController | null>(null);
  const contentInputRef = useRef<TextInput>(null);

  // 双链输入联想状态
  const [wikiSuggestVisible, setWikiSuggestVisible] = useState(false);
  const [wikiSuggestKeyword, setWikiSuggestKeyword] = useState('');
  const [wikiMatchRange, setWikiMatchRange] = useState<{ start: number; end: number } | null>(null);

  // 检测光标前是否存在未闭合的 [[
  const checkWikiLinkTrigger = (text: string, selection: { start: number; end: number }) => {
    if (selection.start !== selection.end) {
      setWikiSuggestVisible(false);
      return;
    }

    const pos = selection.start;
    const textBefore = text.slice(0, pos);
    const lastOpen = textBefore.lastIndexOf('[[');
    if (lastOpen === -1) {
      setWikiSuggestVisible(false);
      return;
    }

    const textAfterOpen = textBefore.slice(lastOpen + 2);
    if (textAfterOpen.includes('\n') || textAfterOpen.includes(']]')) {
      setWikiSuggestVisible(false);
      return;
    }

    setWikiSuggestKeyword(textAfterOpen);
    setWikiMatchRange({ start: lastOpen, end: pos });
    setWikiSuggestVisible(true);
  };

  // 快捷插入 [[ 并呼起联想条
  const handleTriggerWikiLink = () => {
    const pos = cursorPosition.end || content.length;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const newContent = `${before}[[${after}`;
    setContent(newContent);
    const newPos = pos + 2;
    setCursorPosition({ start: newPos, end: newPos });
    setWikiSuggestKeyword('');
    setWikiMatchRange({ start: pos, end: newPos });
    setWikiSuggestVisible(true);
  };

  // 选择双链候选并自动闭合
  const handleSelectWikiSuggestion = (selectedTitle: string) => {
    if (!wikiMatchRange) return;
    const before = content.slice(0, wikiMatchRange.start);
    const after = content.slice(wikiMatchRange.end);
    const replacement = `[[${selectedTitle}]] `;
    const newContent = `${before}${replacement}${after}`;
    setContent(newContent);
    const nextPos = before.length + replacement.length;
    setCursorPosition({ start: nextPos, end: nextPos });
    setWikiSuggestVisible(false);
    setWikiMatchRange(null);
  };

  // 组件卸载时中止请求
  useEffect(() => {
    return () => {
      if (inlineAbortControllerRef.current) {
        inlineAbortControllerRef.current.abort();
      }
    };
  }, []);

  // 加载既有笔记数据（若为编辑模式）
  useEffect(() => {
    const fetchNote = async () => {
      if (!id) {
        // 新建模式，如果本地有上次未保存的草稿则加载
        try {
          const draftKey = `${Config.storageKeys.draftsPrefix}new`;
          const savedDraft = await AsyncStorage.getItem(draftKey);
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft);
            if (parsed.title) setTitle(parsed.title);
            if (parsed.content) setContent(parsed.content);
          }
        } catch (e) {}
        setIsLoading(false);
        return;
      }

      try {
        const res = await notesApi.getNoteDetail(id);
        if (res.code === 200 && res.data) {
          setTitle(res.data.title || '');
          setContent(res.data.content || '');
          setNotebookId(res.data.notebookId);
        }
      } catch (e: any) {
        Alert.alert('加载错误', e.message || '获取笔记内容失败');
      } finally {
        setIsLoading(false);
      }
    };

    fetchNote();
  }, [id]);

  // 自动保存草稿到本地存储
  useEffect(() => {
    if (!title && !content) return;
    const timer = setTimeout(async () => {
      try {
        const draftKey = `${Config.storageKeys.draftsPrefix}${id || 'new'}`;
        await AsyncStorage.setItem(
          draftKey,
          JSON.stringify({ title, content, notebookId, savedAt: Date.now() })
        );
      } catch (e) {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [title, content, notebookId, id]);

  // 插入 Markdown 辅助标记符号
  const insertText = (prefix: string, suffix = '') => {
    const { start, end } = cursorPosition;
    const before = content.substring(0, start);
    const selected = content.substring(start, end);
    const after = content.substring(end);

    const inserted = `${prefix}${selected}${suffix}`;
    const newContent = `${before}${inserted}${after}`;
    setContent(newContent);

    // 重新聚焦
    const newPos = start + prefix.length + selected.length;
    setCursorPosition({ start: newPos, end: newPos });
  };

  // 选择相册或拍照插入图片
  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要权限', '请在系统设置中允许访问相册以上传笔记配图');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setIsUploadingImage(true);

      const res = await notesApi.uploadNoteImage(asset);
      if (res.code === 200 && res.data && res.data.url) {
        // 在光标处插入 Markdown 图像引用
        const imgMarkdown = `\n![${asset.fileName || 'image'}](${res.data.url})\n`;
        insertText(imgMarkdown);
        Alert.alert('上传成功', '图片已插入至当前正文');
      } else {
        throw new Error(res.message || '上传失败');
      }
    } catch (e: any) {
      Alert.alert('图片上传错误', e.message || '网络连接异常');
    } finally {
      setIsUploadingImage(false);
    }
  };

  // 启动行内 AI 流式生成
  const startInlineStream = (params: {
    action: string;
    text?: string;
    noteTitle?: string;
    customPrompt?: string;
  }) => {
    if (inlineAbortControllerRef.current) {
      inlineAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    inlineAbortControllerRef.current = controller;

    setInlineCardVisible(true);
    setInlineIsStreaming(true);
    setInlineStreamingText('');
    setInlineErrorMessage('');

    streamAICall(params, {
      signal: controller.signal,
      onDelta: (_, fullText) => {
        setInlineStreamingText(fullText);
      },
      onFinish: fullText => {
        setInlineStreamingText(fullText);
        setInlineIsStreaming(false);
      },
      onError: err => {
        if (err.name === 'AbortError') {
          setInlineIsStreaming(false);
          return;
        }
        setInlineErrorMessage(err.message || '生成失败，请检查网络服务');
        setInlineIsStreaming(false);
      },
    }).catch(err => {
      if (err.name !== 'AbortError') {
        setInlineErrorMessage(err.message || '网络连接异常');
      }
      setInlineIsStreaming(false);
    });
  };

  // 触发某项行内 AI 动作
  const handleTriggerInlineAI = (actionKey: string, customPrompt?: string) => {
    // 捕获当前的选区快照
    const range = { ...cursorPosition };
    const hasSelection = range.start !== range.end;
    setInlineSelectionSnapshot(range);

    const ACTION_NAMES: Record<string, string> = {
      polish: '✨ 智能润色',
      expand: '📖 丰富扩写',
      summarize_text: '✂️ 精简提炼',
      grammar: '🩺 纠错校对',
      continue: '⏩ 承接续写',
      full_summary: '📑 全文摘要',
      extract_todos: '✅ 提取待办',
      custom: customPrompt ? `💬 ${customPrompt.slice(0, 8)}...` : '💬 自定义指令',
    };
    setInlineActionName(ACTION_NAMES[actionKey] || '✨ AI 创作');

    let targetText = '';
    if (hasSelection) {
      targetText = content.substring(range.start, range.end);
    } else {
      if (actionKey === 'continue') {
        targetText = range.end > 0 ? content.substring(0, range.end) : content;
      } else {
        targetText = content;
      }
    }

    if (!targetText.trim() && actionKey !== 'custom') {
      Alert.alert('提示', '当前选区或正文内容为空，无法执行该操作');
      return;
    }

    const params = {
      action: actionKey,
      text: targetText,
      noteTitle: title,
      customPrompt,
    };

    setLastInlineParams(params);
    startInlineStream(params);
  };

  // 中止当前行内生成
  const handleStopInlineStream = () => {
    if (inlineAbortControllerRef.current) {
      inlineAbortControllerRef.current.abort();
      inlineAbortControllerRef.current = null;
    }
    setInlineIsStreaming(false);
  };

  // 替换选区内容
  const handleApplyInlineReplace = (replacementText: string) => {
    handleStopInlineStream();
    const range = inlineSelectionSnapshot || cursorPosition;
    if (range.start !== range.end) {
      const before = content.substring(0, range.start);
      const after = content.substring(range.end);
      setContent(before + replacementText + after);
      const newPos = range.start + replacementText.length;
      setCursorPosition({ start: newPos, end: newPos });
    } else {
      setContent(replacementText);
    }
    setInlineCardVisible(false);
    setInlineSelectionSnapshot(null);
  };

  // 追加或插入到正文
  const handleApplyInlineInsert = (insertionText: string) => {
    handleStopInlineStream();
    const range = inlineSelectionSnapshot || cursorPosition;
    const insertPos = range.end || content.length;
    const before = content.substring(0, insertPos);
    const after = content.substring(insertPos);
    const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
    setContent(before + prefix + insertionText + after);
    const newPos = insertPos + prefix.length + insertionText.length;
    setCursorPosition({ start: newPos, end: newPos });

    setInlineCardVisible(false);
    setInlineSelectionSnapshot(null);
  };

  // 保存笔记
  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('提示', '请输入笔记标题');
      return;
    }

    try {
      setIsSaving(true);
      if (id) {
        // 更新现有笔记
        const res = await notesApi.updateNote(id, { title: title.trim(), content });
        if (res.code === 200) {
          // 清理草稿
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${id}`);
          Alert.alert('成功', '笔记已保存');
          router.back();
        } else {
          throw new Error(res.message);
        }
      } else {
        // 新建笔记：若无 notebookId，先自动绑定首个笔记本
        let targetNbId = notebookId;
        if (!targetNbId) {
          const nbRes = await notesApi.getNotebooks();
          if (nbRes.code === 200 && nbRes.data.length > 0) {
            targetNbId = nbRes.data[0]._id;
          } else {
            throw new Error('请先在“笔记本”标签页创建一个笔记本');
          }
        }

        const res = await notesApi.createNote({
          title: title.trim(),
          content,
          notebookId: targetNbId,
          parentId: initialParentId || null,
        });

        if (res.code === 200) {
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}new`);
          Alert.alert('成功', '笔记已创建');
          router.back();
        } else {
          throw new Error(res.message);
        }
      }
    } catch (e: any) {
      Alert.alert('保存失败', e.message || '网络错误');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: id ? '编辑笔记' : '新建笔记',
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {Boolean(id) && (
                <TouchableOpacity
                  style={styles.historyHeaderBtn}
                  onPress={() => setShowHistoryModal(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={18} color="#475569" />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.aiHeaderBtn}
                onPress={() => setShowAIModal(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="sparkles" size={16} color="#7c3aed" />
                <Text style={styles.aiHeaderBtnText}>AI创作</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveHeaderBtn, isSaving && styles.saveHeaderBtnDisabled]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveHeaderBtnText}>保存</Text>
                )}
              </TouchableOpacity>
            </View>
          ),
        }}
      />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
        >
          <ScrollView
            style={styles.editorScroll}
            contentContainerStyle={styles.editorContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* 标题输入 */}
            <TextInput
              style={styles.titleInput}
              placeholder="请输入标题..."
              placeholderTextColor="#94a3b8"
              value={title}
              onChangeText={setTitle}
              maxLength={120}
            />

            {/* 正文输入 */}
            <TextInput
              ref={contentInputRef}
              style={styles.contentInput}
              placeholder="开始记录您的思考 (支持 Markdown 语法)..."
              placeholderTextColor="#94a3b8"
              value={content}
              onChangeText={text => {
                setContent(text);
                checkWikiLinkTrigger(text, cursorPosition);
              }}
              multiline
              scrollEnabled={Platform.OS === 'web' ? true : false}
              textAlignVertical="top"
              onSelectionChange={e => {
                const sel = e.nativeEvent.selection;
                setCursorPosition(sel);
                checkWikiLinkTrigger(content, sel);
              }}
            />
          </ScrollView>

          {/* 行内 AI 悬浮流式预览卡片 */}
          <InlineAIStreamCard
            visible={inlineCardVisible}
            actionTitle={inlineActionName}
            isStreaming={inlineIsStreaming}
            streamingText={inlineStreamingText}
            errorMessage={inlineErrorMessage}
            hasSelection={Boolean(
              inlineSelectionSnapshot &&
                inlineSelectionSnapshot.start !== inlineSelectionSnapshot.end
            )}
            onStop={handleStopInlineStream}
            onApplyReplace={handleApplyInlineReplace}
            onApplyInsert={handleApplyInlineInsert}
            onClose={() => {
              handleStopInlineStream();
              setInlineCardVisible(false);
              setInlineSelectionSnapshot(null);
            }}
            onRetry={lastInlineParams ? () => startInlineStream(lastInlineParams) : undefined}
          />

          {/* 双链输入联想浮动胶囊条 */}
          <LinkSuggestBar
            visible={wikiSuggestVisible}
            keyword={wikiSuggestKeyword}
            onSelectSuggestion={handleSelectWikiSuggestion}
            onClose={() => setWikiSuggestVisible(false)}
          />

          {/* 智能感知联动工具栏 */}
          <InlineAIToolbar
            hasSelection={cursorPosition.start !== cursorPosition.end}
            selectedTextLength={Math.abs(cursorPosition.end - cursorPosition.start)}
            isGenerating={inlineIsStreaming}
            isUploadingImage={isUploadingImage}
            onInsertMarkdown={insertText}
            onPickImage={handlePickImage}
            onOpenFullAIModal={() => setShowAIModal(true)}
            onTriggerAIAction={handleTriggerInlineAI}
            onTriggerWikiLink={handleTriggerWikiLink}
          />
        </KeyboardAvoidingView>
      )}

      {/* AI 创作助手 */}
      <AIAssistantModal
        visible={showAIModal}
        onClose={() => setShowAIModal(false)}
        noteTitle={title}
        noteContent={content}
        selectedText={content.substring(cursorPosition.start, cursorPosition.end)}
        isEditable={true}
        onReplaceSelection={replacement => {
          const { start, end } = cursorPosition;
          if (start !== end) {
            const before = content.substring(0, start);
            const after = content.substring(end);
            setContent(before + replacement + after);
          } else {
            setContent(replacement);
          }
        }}
        onInsertContent={insertion => {
          const { start, end } = cursorPosition;
          const insertPos = end || content.length;
          const before = content.substring(0, insertPos);
          const after = content.substring(insertPos);
          setContent(before + insertion + after);
        }}
      />

      {/* 历史版本快照 */}
      {Boolean(id) && (
        <VersionHistoryModal
          visible={showHistoryModal}
          onClose={() => setShowHistoryModal(false)}
          noteId={id!}
          currentContent={content}
          onRollbackSuccess={updatedNote => {
            setTitle(updatedNote.title || '');
            setContent(updatedNote.content || '');
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  keyboardContainer: {
    flex: 1,
  },
  saveHeaderBtn: {
    backgroundColor: '#1890ff',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  saveHeaderBtnDisabled: {
    opacity: 0.6,
  },
  saveHeaderBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  editorScroll: {
    flex: 1,
  },
  editorContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    flexGrow: 1,
  },
  titleInput: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  contentInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 26,
    color: '#1e293b',
    minHeight: 480,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          fieldSizing: 'content',
        } as any)
      : {}),
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyHeaderBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  aiHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  aiHeaderBtnText: {
    color: '#7c3aed',
    fontSize: 13,
    fontWeight: '600',
  },
});
