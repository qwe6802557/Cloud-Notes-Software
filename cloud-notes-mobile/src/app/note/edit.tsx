import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import WikiSuggestDock from '../../components/WikiSuggestDock';
import GhostLinkSuggestStrip from '../../components/GhostLinkSuggestStrip';
import SyncStatusPill from '../../components/SyncStatusPill';
import ConflictResolveModal from '../../components/ConflictResolveModal';
import {
  getNoteCache,
  saveNoteCache,
  resolveNoteId,
  hasPendingMutationsForNote,
} from '../../utils/storage/mobileNotesDB';
import mobileSyncManager, { ConflictEntry } from '../../utils/storage/mobileSyncManager';
import * as cryptoVault from '../../utils/cryptoVault';
import VaultUnlockModal from '../../components/VaultUnlockModal';

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
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | undefined>(undefined);
  const [resolvedNoteId, setResolvedNoteId] = useState<string>(id || '');
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const baseVersionRef = useRef<number | undefined>(undefined);
  const syncSeqRef = useRef(0);

  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    baseVersionRef.current = baseVersion;
  }, [baseVersion]);

  const [cursorPosition, setCursorPosition] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });

  const [showAIModal, setShowAIModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [vaultUnlockTick, setVaultUnlockTick] = useState(0);
  const [activeConflict, setActiveConflict] = useState<ConflictEntry | null>(null);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);

  const handleToggleEncryption = () => {
    if (!isEncrypted && !cryptoVault.hasSessionKey()) {
      setShowVaultModal(true);
      return;
    }
    const nextEncrypted = !isEncrypted;
    setIsEncrypted(nextEncrypted);
    setIsDirty(true);
    isDirtyRef.current = true;
  };

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

  // 概念感知 (Ghost Link) 展开状态
  const [ghostSuggestVisible, setGhostSuggestVisible] = useState(false);

  // 检测光标前是否存在未闭合的 [[
  const checkWikiLinkTrigger = useCallback(
    (text: string, selection?: { start: number; end: number }) => {
      if (selection && selection.start !== selection.end) {
        setWikiSuggestVisible(false);
        return;
      }

      let pos = selection ? selection.start : cursorPosition.start;
      if (typeof pos !== 'number' || pos < 0 || pos > text.length) {
        pos = text.length;
      }

      let textBefore = text.slice(0, pos);
      let lastOpen = textBefore.lastIndexOf('[[');

      // 容错：若光标处未找到，但文本末尾包含未闭合的 [[（常见于快速输入或拼音上屏）
      if (lastOpen === -1) {
        const globalLastOpen = text.lastIndexOf('[[');
        if (globalLastOpen !== -1) {
          const textAfter = text.slice(globalLastOpen + 2);
          if (!textAfter.includes('\n') && !textAfter.includes(']]')) {
            lastOpen = globalLastOpen;
            pos = text.length;
            textBefore = text;
          }
        }
      }

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
    },
    [cursorPosition.start]
  );

  useEffect(() => {
    if (!content) return;
    const timer = setTimeout(() => {
      checkWikiLinkTrigger(content);
    }, 0);
    return () => clearTimeout(timer);
  }, [content, checkWikiLinkTrigger]);

  // 快捷插入 [[ 并呼起联想贴顶面板
  const handleTriggerWikiLink = () => {
    const pos = cursorPosition.end || content.length;
    const before = content.slice(0, pos);
    const after = content.slice(pos);
    const newContent = `${before}[[${after}`;
    handleContentChange(newContent);
    const newPos = pos + 2;
    setCursorPosition({ start: newPos, end: newPos });
    setWikiSuggestKeyword('');
    setWikiMatchRange({ start: pos, end: newPos });
    setWikiSuggestVisible(true);
  };

  // 选择双链候选并自动闭合（支持已有实体笔记与优雅悬空双链）
  const handleSelectWikiSuggestion = (selectedTitle: string, isGhost = false) => {
    if (!wikiMatchRange) return;
    const before = content.slice(0, wikiMatchRange.start);
    const after = content.slice(wikiMatchRange.end);
    const replacement = `[[${selectedTitle}]] `;
    const newContent = `${before}${replacement}${after}`;
    handleContentChange(newContent);
    const nextPos = before.length + replacement.length;
    setCursorPosition({ start: nextPos, end: nextPos });
    setWikiSuggestVisible(false);
    setWikiMatchRange(null);
  };

  // 单个词汇安全转换为 [[双链]]
  const handleConvertGhostWord = (word: string) => {
    if (!content || !word) return;
    const placeholders: string[] = [];
    let protectedText = content.replace(/\[\[[^\]\r\n]+\]\]/g, match => {
      placeholders.push(match);
      return `__WIKI_PLACEHOLDER_${placeholders.length - 1}__`;
    });

    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = new RegExp(escaped, 'g');
    protectedText = protectedText.replace(wordRegex, `[[${word}]]`);

    const finalContent = protectedText.replace(/__WIKI_PLACEHOLDER_(\d+)__/g, (_, idx) => {
      return placeholders[Number(idx)] || '';
    });

    if (finalContent !== content) {
      setContent(finalContent);
      Alert.alert('已织入双链', `已将命中的「${word}」转换为 [[${word}]]`);
    }
  };

  // 批量词汇安全转换为 [[双链]]
  const handleConvertAllGhostWords = (words: string[]) => {
    if (!content || !words.length) return;
    let current = content;

    words.forEach(word => {
      const placeholders: string[] = [];
      let protectedText = current.replace(/\[\[[^\]\r\n]+\]\]/g, match => {
        placeholders.push(match);
        return `__WIKI_PLACEHOLDER_${placeholders.length - 1}__`;
      });

      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(escaped, 'g');
      protectedText = protectedText.replace(wordRegex, `[[${word}]]`);

      current = protectedText.replace(/__WIKI_PLACEHOLDER_(\d+)__/g, (_, idx) => {
        return placeholders[Number(idx)] || '';
      });
    });

    if (current !== content) {
      setContent(current);
      Alert.alert('已全部织入', `已成功将 ${words.length} 处概念词条升级为 [[双链]]`);
      setGhostSuggestVisible(false);
    }
  };

  // 组件卸载时中止请求
  useEffect(() => {
    return () => {
      if (inlineAbortControllerRef.current) {
        inlineAbortControllerRef.current.abort();
      }
    };
  }, []);

  const reloadResolvedLocalCache = useCallback(async (targetNoteId: string) => {
    const resolvedId = await resolveNoteId(targetNoteId);
    const cached = await getNoteCache(resolvedId);
    if (!cached) return;

    let restoredContent = cached.content || '';
    if (cached.isEncrypted && cached.encryptedData) {
      if (cryptoVault.hasSessionKey()) {
        try {
          restoredContent = await cryptoVault.decryptNote(
            cached.encryptedData,
            cryptoVault.getSessionKey()!
          );
        } catch (err) {
          console.warn('Failed to decrypt resolved cache:', err);
        }
      } else {
        setShowVaultModal(true);
      }
    }

    setTitle(cached.title || '');
    setContent(restoredContent);
    setIsEncrypted(Boolean(cached.isEncrypted));
    setBaseUpdatedAt(cached.remoteUpdatedAt || cached.updatedAt || null);
    setBaseVersion(cached.contentVersion);
    baseVersionRef.current = cached.contentVersion;
    setIsDirty(Boolean(cached.isDirty));
    isDirtyRef.current = Boolean(cached.isDirty);
    if (cached.notebookId) {
      setNotebookId(cached.notebookId);
    }
  }, []);

  // 订阅当前笔记的冲突状态变化与解决事件
  useEffect(() => {
    const targetId = resolvedNoteId || id;
    if (!targetId) return;

    const unsubscribeSync = mobileSyncManager.subscribe(snapshot => {
      const matched = snapshot.conflicts?.find(c => c.noteId === targetId) || null;
      setActiveConflict(matched);
    });

    const unsubscribeResolved = mobileSyncManager.subscribeConflictResolved(
      (resolvedId, strategy) => {
        if (resolvedId === targetId && strategy !== 'keep_local') {
          void reloadResolvedLocalCache(resolvedId);
        }
      }
    );

    return () => {
      unsubscribeSync();
      unsubscribeResolved();
    };
  }, [id, resolvedNoteId, reloadResolvedLocalCache]);

  // 加载既有笔记数据（草稿与脏缓存优先保护，SWR 绝不覆写未同步本地改动）
  useEffect(() => {
    let cancelled = false;

    const readDraft = async (draftKey: string) => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed?.isEncrypted && parsed?.encryptedData) {
          if (cryptoVault.hasSessionKey()) {
            const plain = await cryptoVault.decryptNote(
              parsed.encryptedData,
              cryptoVault.getSessionKey()!
            );
            return { ...parsed, content: plain };
          }
          return { ...parsed, needsUnlock: true };
        }
        return parsed;
      } catch {
        return null;
      }
    };

    const fetchNote = async () => {
      if (!id) {
        const parsed = await readDraft(`${Config.storageKeys.draftsPrefix}new`);
        if (cancelled) return;
        if (parsed) {
          if (parsed.needsUnlock) {
            setShowVaultModal(true);
          } else {
            if (parsed.title) setTitle(parsed.title);
            if (parsed.content) setContent(parsed.content);
            if (parsed.isEncrypted) setIsEncrypted(true);
            if (parsed.notebookId) setNotebookId(parsed.notebookId);
          }
        }
        setIsLoading(false);
        return;
      }

      const targetId = await resolveNoteId(id);
      if (cancelled) return;
      setResolvedNoteId(targetId);

      let cacheHasDirtyState = false;

      // 1. 本地优先：同时比对本地缓存快照与自动草稿时间戳，择优无损上屏
      try {
        const localCache = await getNoteCache(targetId);
        const draftPrimary = await readDraft(`${Config.storageKeys.draftsPrefix}${targetId}`);
        const draftFallback =
          targetId !== id
            ? await readDraft(`${Config.storageKeys.draftsPrefix}${id}`)
            : null;
        const draft = draftPrimary || draftFallback;

        const cacheTime = localCache?.updatedAt ? new Date(localCache.updatedAt).getTime() : 0;
        const draftTime = typeof draft?.savedAt === 'number' ? draft.savedAt : 0;
        const hasPendingQueue = await hasPendingMutationsForNote(targetId);
        const hasConflict = mobileSyncManager.hasConflict(targetId);

        if (draft && !draft.needsUnlock && (draftTime > cacheTime || !localCache)) {
          cacheHasDirtyState = true;
          setTitle(draft.title || '');
          setContent(draft.content || '');
          setIsEncrypted(Boolean(draft.isEncrypted ?? localCache?.isEncrypted));
          if (draft.notebookId) setNotebookId(draft.notebookId);
          setBaseUpdatedAt(localCache?.remoteUpdatedAt || localCache?.updatedAt || null);
          setBaseVersion(localCache?.contentVersion);
          baseVersionRef.current = localCache?.contentVersion;
          setIsDirty(true);
          isDirtyRef.current = true;
          setIsLoading(false);
        } else if (draft?.needsUnlock) {
          setShowVaultModal(true);
        } else if (localCache) {
          cacheHasDirtyState = Boolean(localCache.isDirty || hasPendingQueue || hasConflict);
          let localPlainContent = localCache.content || '';
          if (localCache.isEncrypted && localCache.encryptedData) {
            if (cryptoVault.hasSessionKey()) {
              try {
                localPlainContent = await cryptoVault.decryptNote(
                  localCache.encryptedData,
                  cryptoVault.getSessionKey()!
                );
              } catch (err) {
                console.warn('Failed to decrypt local cache:', err);
              }
            } else {
              setShowVaultModal(true);
            }
          }
          if (!cancelled) {
            setTitle(localCache.title || '');
            setContent(localPlainContent);
            setIsEncrypted(Boolean(localCache.isEncrypted));
            if (localCache.notebookId) setNotebookId(localCache.notebookId);
            setBaseUpdatedAt(localCache.remoteUpdatedAt || localCache.updatedAt || null);
            setBaseVersion(localCache.contentVersion);
            baseVersionRef.current = localCache.contentVersion;
            if (cacheHasDirtyState) {
              setIsDirty(true);
              isDirtyRef.current = true;
            }
            setIsLoading(false);
          }
        } else if (hasPendingQueue || hasConflict) {
          cacheHasDirtyState = true;
          isDirtyRef.current = true;
          setIsDirty(true);
        }
      } catch {}

      if (targetId.startsWith('local_') || cancelled) {
        setIsLoading(false);
        return;
      }

      // 2. SWR 后台异步拉取远端对齐（存在未同步脏改动时严禁覆盖屏幕与本地缓存）
      try {
        const res = await notesApi.getNoteDetail(targetId);
        if (cancelled) return;
        if (res.code === 200 && res.data) {
          const remote = res.data;
          const stillHasDirtyEdits =
            cacheHasDirtyState ||
            isDirtyRef.current ||
            (await hasPendingMutationsForNote(targetId)) ||
            mobileSyncManager.hasConflict(targetId);

          if (stillHasDirtyEdits) {
            if (!notebookId && remote.notebookId) {
              setNotebookId(remote.notebookId);
            }
            return;
          }

          setIsEncrypted(Boolean(remote.isEncrypted));
          let noteContent = remote.content || '';
          if (remote.isEncrypted && remote.encryptedData) {
            if (cryptoVault.hasSessionKey()) {
              try {
                noteContent = await cryptoVault.decryptNote(
                  remote.encryptedData,
                  cryptoVault.getSessionKey()!
                );
              } catch (err) {
                console.warn('Failed to decrypt:', err);
              }
            } else {
              setShowVaultModal(true);
            }
          }
          if (cancelled) return;

          mobileSyncManager.setLastKnownRemoteUpdatedAt(
            targetId,
            remote.updatedAt,
            remote.isEncrypted ? '' : noteContent,
            remote.contentVersion
          );
          setTitle(remote.title || '');
          setContent(noteContent);
          setBaseUpdatedAt(remote.updatedAt || null);
          setBaseVersion(remote.contentVersion);
          baseVersionRef.current = remote.contentVersion;
          setIsDirty(false);
          isDirtyRef.current = false;
          setNotebookId(remote.notebookId);

          await saveNoteCache({
            id: targetId,
            title: remote.title || '',
            content: remote.isEncrypted ? '' : (remote.content || ''),
            notebookId: remote.notebookId,
            parentId: remote.parentId,
            isEncrypted: Boolean(remote.isEncrypted),
            encryptedData: remote.encryptedData ?? null,
            contentVersion: remote.contentVersion,
            remoteUpdatedAt: remote.updatedAt,
            updatedAt: remote.updatedAt,
            lastSavedContent: remote.isEncrypted ? '' : (remote.content || ''),
            lastSyncedAt: new Date().toISOString(),
            isDirty: false,
          });
        }
      } catch {
        // 离线无网时静默依靠本地快照正常编辑
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchNote();

    return () => {
      cancelled = true;
    };
  }, [id, vaultUnlockTick]);

  // 自动保存草稿到本地存储（加密笔记仅存密文，绝不明文落盘）
  useEffect(() => {
    if (!title && !content) return;
    if (isEncrypted && !cryptoVault.hasSessionKey()) return;

    const timer = setTimeout(async () => {
      try {
        const targetDraftId = resolvedNoteId || id || 'new';
        const draftKey = `${Config.storageKeys.draftsPrefix}${targetDraftId}`;
        if (isEncrypted && cryptoVault.hasSessionKey()) {
          const pin = cryptoVault.getSessionKey()!;
          const salt = cryptoVault.getSessionSalt() || '00'.repeat(16);
          const encryptedData = await cryptoVault.encryptNote(content, pin, salt);
          await AsyncStorage.setItem(
            draftKey,
            JSON.stringify({
              title,
              isEncrypted: true,
              encryptedData,
              notebookId,
              savedAt: Date.now(),
            })
          );
        } else {
          await AsyncStorage.setItem(
            draftKey,
            JSON.stringify({
              title,
              content,
              isEncrypted: false,
              notebookId,
              savedAt: Date.now(),
            })
          );
        }
      } catch {}
    }, 1500);

    return () => clearTimeout(timer);
  }, [title, content, notebookId, id, resolvedNoteId, isEncrypted]);

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

  const dispatchAutoSync = async (nextTitle: string, nextContent: string) => {
    if (!id) return;
    const seq = ++syncSeqRef.current;

    if (isEncrypted && !cryptoVault.hasSessionKey()) {
      setShowVaultModal(true);
      return;
    }

    const targetId = await resolveNoteId(id);
    if (seq !== syncSeqRef.current) return;

    let encryptedData: string | null = null;
    if (isEncrypted) {
      const pin = cryptoVault.getSessionKey()!;
      const salt = cryptoVault.getSessionSalt() || '00'.repeat(16);
      encryptedData = await cryptoVault.encryptNote(nextContent, pin, salt);
      if (seq !== syncSeqRef.current) return;
    }

    const safePlainContent = isEncrypted ? '' : nextContent;
    await mobileSyncManager.notifyLocalDirty(targetId, {
      title: nextTitle,
      content: safePlainContent,
      baseUpdatedAt,
      expectedVersion: baseVersionRef.current,
      notebookId,
      parentId: initialParentId || null,
      isEncrypted,
      encryptedData,
    });

    if (seq !== syncSeqRef.current) return;

    mobileSyncManager.scheduleAutoSync(
      targetId,
      {
        title: nextTitle,
        content: safePlainContent,
        baseUpdatedAt,
        expectedVersion: baseVersionRef.current,
        notebookId,
        parentId: initialParentId || null,
        isEncrypted,
        encryptedData,
        onSyncSuccess: syncRes => {
          if (syncRes?.resolvedId && syncRes.resolvedId !== resolvedNoteId) {
            setResolvedNoteId(syncRes.resolvedId);
          }
          if (seq === syncSeqRef.current) {
            setIsDirty(false);
            isDirtyRef.current = false;
            void AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${id}`).catch(() => {});
            if (targetId !== id) {
              void AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${targetId}`).catch(() => {});
            }
          }
          if (syncRes?.updatedAt) {
            setBaseUpdatedAt(syncRes.updatedAt);
          }
          if (typeof syncRes?.contentVersion === 'number') {
            setBaseVersion(syncRes.contentVersion);
            baseVersionRef.current = syncRes.contentVersion;
          }
        },
      },
      1500
    );
  };

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    setIsDirty(true);
    isDirtyRef.current = true;
    void dispatchAutoSync(newTitle, content);
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    setIsDirty(true);
    isDirtyRef.current = true;
    void dispatchAutoSync(title, newContent);
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
        const targetId = await resolveNoteId(id);
        let encryptedData: string | null = null;
        if (isEncrypted) {
          if (!cryptoVault.hasSessionKey()) {
            setIsSaving(false);
            setShowVaultModal(true);
            return;
          }
          const pin = cryptoVault.getSessionKey()!;
          const salt = cryptoVault.getSessionSalt() || '00'.repeat(16);
          encryptedData = await cryptoVault.encryptNote(content, pin, salt);
        }

        const syncRes = await mobileSyncManager.syncNote(targetId, {
          title: title.trim(),
          content: isEncrypted ? '' : content,
          baseUpdatedAt,
          expectedVersion: baseVersionRef.current,
          notebookId,
          parentId: initialParentId || null,
          isEncrypted,
          encryptedData,
          saveType: 'manual',
        });

        if (syncRes.conflict) {
          setIsSaving(false);
          setConflictModalVisible(true);
          return;
        }

        if (!syncRes.success && !syncRes.offline) {
          const errMsg =
            typeof syncRes.error === 'string'
              ? syncRes.error
              : syncRes.error?.message || '保存失败，请稍后重试';
          Alert.alert('保存失败', errMsg);
          return;
        }

        setIsDirty(false);
        isDirtyRef.current = false;
        await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${id}`);
        if (targetId !== id) {
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${targetId}`);
        }

        if (syncRes.forked && syncRes.forkedNote) {
          Alert.alert('已生成冲突副本', `检测到云端存在并发修改，本地内容已另存为：${syncRes.forkedNote.title}`);
        } else if (syncRes.offline) {
          Alert.alert('已离线安全落盘', '当前处于无网络环境，修改已牢固保存在本地并加入重试队列');
        } else {
          Alert.alert('成功', '笔记已保存');
        }
        router.back();
      } else {
        // 新建笔记：若无 notebookId，先自动绑定首个笔记本
        let targetNbId = notebookId;
        if (!targetNbId) {
          try {
            const nbRes = await notesApi.getNotebooks();
            if (nbRes.code === 200 && nbRes.data.length > 0) {
              targetNbId = nbRes.data[0]._id;
            }
          } catch {}
        }

        let createEncryptedData: string | null = null;
        if (isEncrypted) {
          if (!cryptoVault.hasSessionKey()) {
            setIsSaving(false);
            setShowVaultModal(true);
            return;
          }
          const pin = cryptoVault.getSessionKey()!;
          const salt = cryptoVault.getSessionSalt() || '00'.repeat(16);
          createEncryptedData = await cryptoVault.encryptNote(content, pin, salt);
        }

        const syncState = mobileSyncManager.getSnapshot();
        if (!syncState.isOnline) {
          await mobileSyncManager.createOfflineNote({
            title: title.trim(),
            content: isEncrypted ? '' : content,
            notebookId: targetNbId,
            parentId: initialParentId || null,
            isEncrypted,
            encryptedData: createEncryptedData,
          });
          setIsDirty(false);
          isDirtyRef.current = false;
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}new`);
          Alert.alert('已离线安全落盘', '当前处于无网络环境，新建笔记已牢固保存在本地并加入重试队列');
          router.back();
          return;
        }

        try {
          const clientId = `mobile_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const res = await notesApi.createNote({
            title: title.trim(),
            content: isEncrypted ? '' : content,
            notebookId: targetNbId,
            parentId: initialParentId || null,
            isEncrypted,
            encryptedData: createEncryptedData,
            clientId,
          });

          if (res.code === 200 && res.data) {
            const newId = (res.data as any)?._id || (res.data as any)?.id;
            await saveNoteCache({
              id: newId,
              title: res.data.title,
              content: res.data.isEncrypted ? '' : res.data.content,
              notebookId: res.data.notebookId,
              parentId: res.data.parentId,
              isEncrypted: Boolean(res.data.isEncrypted),
              encryptedData: res.data.encryptedData ?? createEncryptedData ?? null,
              contentVersion: res.data.contentVersion,
              remoteUpdatedAt: res.data.updatedAt,
              updatedAt: res.data.updatedAt,
              lastSavedContent: res.data.isEncrypted ? '' : res.data.content,
              lastSyncedAt: new Date().toISOString(),
              isDirty: false,
            });
            await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}new`);
            Alert.alert('成功', '笔记已创建');
            router.back();
          } else {
            throw new Error(res.message);
          }
        } catch {
          // 弱网创建失败自动降级本地离线安全落盘（保持加密密文与目标目录）
          await mobileSyncManager.createOfflineNote({
            title: title.trim(),
            content: isEncrypted ? '' : content,
            notebookId: targetNbId,
            parentId: initialParentId || null,
            isEncrypted,
            encryptedData: createEncryptedData,
          });
          setIsDirty(false);
          isDirtyRef.current = false;
          await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}new`);
          Alert.alert('已离线安全落盘', '网络连接异常，新建笔记已在本地安全落盘，后台将自动重试同步');
          router.back();
        }
      }
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <SyncStatusPill />
              <TouchableOpacity
                style={{
                  padding: 6,
                  borderRadius: 6,
                  backgroundColor: isEncrypted ? 'rgba(217, 119, 6, 0.12)' : 'transparent',
                }}
                onPress={handleToggleEncryption}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isEncrypted ? 'lock-closed' : 'lock-open-outline'}
                  size={18}
                  color={isEncrypted ? '#d97706' : '#64748b'}
                />
              </TouchableOpacity>
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
          {Boolean(activeConflict) && (
            <TouchableOpacity
              style={styles.conflictBanner}
              onPress={() => setConflictModalVisible(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="git-compare-outline" size={16} color="#dc2626" />
              <Text style={styles.conflictBannerText} numberOfLines={1}>
                检测到云端有新版本冲突，本地修改已保护，点击立即比对裁决
              </Text>
              <Ionicons name="chevron-forward" size={15} color="#dc2626" />
            </TouchableOpacity>
          )}
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
              onChangeText={handleTitleChange}
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
                handleContentChange(text);
                const diff = text.length - content.length;
                const estimatedPos = Math.max(0, cursorPosition.start + diff);
                checkWikiLinkTrigger(text, { start: estimatedPos, end: estimatedPos });
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

          {/* 概念感知与双链速转条 */}
          <GhostLinkSuggestStrip
            visible={ghostSuggestVisible}
            onClose={() => setGhostSuggestVisible(false)}
            content={content}
            currentNoteId={id}
            currentNoteTitle={title}
            onConvertWord={handleConvertGhostWord}
            onConvertAll={handleConvertAllGhostWords}
          />

          {/* 双链输入联想键盘贴顶流体面板 */}
          <WikiSuggestDock
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
            onTriggerGhostLink={() => setGhostSuggestVisible(prev => !prev)}
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
          const { end } = cursorPosition;
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
          noteId={resolvedNoteId || id!}
          currentContent={content}
          onRollbackSuccess={updatedNote => {
            setTitle(updatedNote.title || '');
            setContent(updatedNote.content || '');
          }}
        />
      )}

      {/* 安全箱解锁弹窗 */}
      <VaultUnlockModal
        visible={showVaultModal}
        onClose={() => setShowVaultModal(false)}
        onSuccess={() => {
          setShowVaultModal(false);
          setVaultUnlockTick(v => v + 1);
        }}
      />

      {/* 版本冲突比对裁决弹窗 */}
      <ConflictResolveModal
        visible={conflictModalVisible}
        conflict={activeConflict}
        onClose={() => setConflictModalVisible(false)}
        onResolved={async strategy => {
          setConflictModalVisible(false);
          if (strategy === 'keep_local') {
            setIsDirty(false);
            isDirtyRef.current = false;
            if (id) {
              await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${id}`);
            }
            if (resolvedNoteId && resolvedNoteId !== id) {
              await AsyncStorage.removeItem(`${Config.storageKeys.draftsPrefix}${resolvedNoteId}`);
            }
          } else if (resolvedNoteId || id) {
            await reloadResolvedLocalCache(resolvedNoteId || id!);
          }
        }}
      />
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
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  conflictBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
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
