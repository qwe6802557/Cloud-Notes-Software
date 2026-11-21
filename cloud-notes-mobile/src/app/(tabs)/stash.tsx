import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as quickNotesApi from '../../api/quickNotesApi';
import {
  QuickMemoCounts,
  QuickMemoCursor,
  QuickMemoItem,
  QuickMemoQuota,
  QuickMemoStorageType,
  resolveQuickMemoUrl,
} from '../../api/quickNotesApi';
import ActionContextSheet, {
  ActionSheetItem,
  confirmAction,
  triggerHaptic,
} from '../../components/ActionContextSheet';
import FilePreviewModal, { PreviewableFile } from '../../components/FilePreviewModal';
import QuickMemoCard, { CountdownBadge } from '../../components/QuickMemoCard';
import QuickNoteConvertModal from '../../components/QuickNoteConvertModal';
import TextPromptModal from '../../components/TextPromptModal';
import { useTheme } from '../../hooks/use-theme';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { showNotice } from '../../utils/noteContextActions';
import {
  QuickKindFilter,
  QuickScopeTab,
  QuickVirtualFolder,
  buildQuickFolderTree,
  computeServerClockOffset,
  createQuickClientId,
  filterQuickMemos,
  formatBytes,
  getUtf8ByteLength,
  isSafeHttpUrl,
  mergeQuickMemoDelta,
  sortQuickMemosAscending,
} from '../../utils/quickNoteHelper';

const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 50 * 1024;

const KIND_FILTERS: { key: QuickKindFilter; label: string }[] = [
  { key: 'all', label: '全部类型' },
  { key: 'text_link', label: '文本·链接' },
  { key: 'image', label: '图片' },
  { key: 'file', label: '文件' },
];

export default function QuickMemoScreen() {
  const router = useRouter();
  const theme = useTheme();
  const isDark = useColorScheme() === 'dark';
  const accentColor = isDark ? '#38bdf8' : '#1890ff';

  const [items, setItems] = useState<QuickMemoItem[]>([]);
  const [counts, setCounts] = useState<QuickMemoCounts>({ all: 0, temp: 0, permanent: 0 });
  const [quota, setQuota] = useState<QuickMemoQuota>({
    permanentUsedBytes: 0,
    permanentLimitBytes: 2 * 1024 * 1024 * 1024,
  });
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  const [scopeTab, setScopeTab] = useState<QuickScopeTab>('all');
  const [kindFilter, setKindFilter] = useState<QuickKindFilter>('all');
  const [viewMode, setViewMode] = useState<'stream' | 'folder'>('stream');
  const [currentPath, setCurrentPath] = useState('');
  const [activeFolderScope, setActiveFolderScope] = useState<QuickMemoStorageType | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [sendStorageType, setSendStorageType] = useState<QuickMemoStorageType>('temp');

  const [isScreenFocused, setIsScreenFocused] = useState(false);
  const [isAppActive, setIsAppActive] = useState(AppState.currentState === 'active');

  const [showAttachSheet, setShowAttachSheet] = useState(false);
  const [showFolderNameModal, setShowFolderNameModal] = useState(false);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [batchCurrentIndex, setBatchCurrentIndex] = useState(0);
  const [batchTotalCount, setBatchTotalCount] = useState(0);
  const [currentUploadingName, setCurrentUploadingName] = useState('');

  const [previewItem, setPreviewItem] = useState<QuickMemoItem | null>(null);
  const [convertTarget, setConvertTarget] = useState<QuickMemoItem | null>(null);
  const [contextSheet, setContextSheet] = useState<{
    title: string;
    subtitle: string;
    items: ActionSheetItem[];
  } | null>(null);

  const flatListRef = useRef<FlatList<QuickMemoItem>>(null);
  const composerInputRef = useRef<TextInput>(null);
  const webFolderInputRef = useRef<any>(null);
  const hasLoadedOnceRef = useRef(false);
  const cursorRef = useRef<QuickMemoCursor>(null);
  const serverOffsetRef = useRef(0);
  const isSyncingDeltaRef = useRef(false);
  const shouldScrollToBottomRef = useRef(true);
  const isNearBottomRef = useRef(true);

  useEffect(() => {
    if (Platform.OS === 'web' && webFolderInputRef.current) {
      webFolderInputRef.current.setAttribute('webkitdirectory', '');
      webFolderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  const loadFullList = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else if (!hasLoadedOnceRef.current) {
        setIsLoading(true);
      }

      const res = await quickNotesApi.getQuickNotes({ limit: 200 });
      if (res.code === 200 && res.data) {
        const offset = computeServerClockOffset(res.data.serverTime);
        serverOffsetRef.current = offset;
        setServerOffsetMs(offset);
        setItems(sortQuickMemosAscending(res.data.items || []));
        if (res.data.counts) setCounts(res.data.counts);
        if (res.data.quota) setQuota(res.data.quota);
        cursorRef.current =
          res.data.nextCursor ||
          (res.data.serverTime ? { since: res.data.serverTime, cursorId: '' } : null);
        if (!hasLoadedOnceRef.current) {
          shouldScrollToBottomRef.current = true;
        }
      }
    } catch (err: any) {
      console.warn('Load quick notes failed:', err?.message);
    } finally {
      hasLoadedOnceRef.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const runDeltaSync = useCallback(async () => {
    if (isSyncingDeltaRef.current) return;
    if (!cursorRef.current?.since) {
      await loadFullList(false);
      return;
    }

    isSyncingDeltaRef.current = true;
    try {
      let currentCursor: QuickMemoCursor = cursorRef.current;
      let hasMore = true;
      let pageGuard = 0;

      while (hasMore && pageGuard < 5 && currentCursor?.since) {
        pageGuard += 1;
        const res = await quickNotesApi.deltaQuickNotes({
          since: currentCursor.since,
          cursorId: currentCursor.cursorId,
          limit: 200,
        });
        if (res.code !== 200 || !res.data) break;

        const data = res.data;
        const offset = computeServerClockOffset(data.serverTime);
        serverOffsetRef.current = offset;
        setServerOffsetMs(offset);

        const hasDeltaItems = Boolean(data.items && data.items.length > 0);
        const hasLegacyPayload = Boolean(data.legacyItems && data.legacyItems.length > 0);
        if (isNearBottomRef.current && hasDeltaItems) {
          shouldScrollToBottomRef.current = true;
        }
        setItems(prev => {
          const hadLegacyBefore = prev.some(it => it.legacySource === 'stash');
          const hasExpiredLocal = prev.some(
            it =>
              it.storageType === 'temp' &&
              it.expireAt &&
              new Date(it.expireAt).getTime() <= Date.now() + offset
          );
          if (!hasDeltaItems && !hasLegacyPayload && !hadLegacyBefore && !hasExpiredLocal) {
            return prev;
          }
          return mergeQuickMemoDelta(
            prev,
            { items: data.items, legacyItems: data.legacyItems },
            offset
          );
        });

        if (data.counts) setCounts(data.counts);
        if (data.quota) setQuota(data.quota);
        if (data.nextCursor) {
          currentCursor = data.nextCursor;
          cursorRef.current = data.nextCursor;
        }
        hasMore = Boolean(data.hasMore);
      }
    } catch (err: any) {
      console.warn('Delta quick notes failed:', err?.message);
    } finally {
      isSyncingDeltaRef.current = false;
    }
  }, [loadFullList]);

  // 仅在页面聚焦且 App 处于前台 active 时启停 5 秒增量同步
  useFocusEffect(
    useCallback(() => {
      setIsScreenFocused(true);
      setIsAppActive(AppState.currentState === 'active');

      if (!hasLoadedOnceRef.current) {
        void loadFullList(false);
      } else {
        void runDeltaSync();
      }

      const appStateSub = AppState.addEventListener('change', nextState => {
        const active = nextState === 'active';
        setIsAppActive(active);
        if (active) {
          void runDeltaSync();
        }
      });

      const pollTimer = setInterval(() => {
        if (AppState.currentState === 'active') {
          void runDeltaSync();
        }
      }, 5000);

      return () => {
        setIsScreenFocused(false);
        clearInterval(pollTimer);
        appStateSub.remove();
      };
    }, [loadFullList, runDeltaSync])
  );

  const isTimerActive = isScreenFocused && isAppActive;

  const filteredStreamItems = useMemo(
    () => filterQuickMemos(items, scopeTab, kindFilter, serverOffsetMs),
    [items, scopeTab, kindFilter, serverOffsetMs]
  );

  const folderTree = useMemo(() => {
    const scoped = filterQuickMemos(items, scopeTab, 'all', serverOffsetMs);
    return buildQuickFolderTree(
      scoped,
      currentPath,
      serverOffsetMs,
      undefined,
      currentPath ? activeFolderScope : null
    );
  }, [items, scopeTab, currentPath, serverOffsetMs, activeFolderScope]);

  const breadcrumbSegments = useMemo(
    () => (currentPath ? currentPath.split('/') : []),
    [currentPath]
  );

  const handleScopeChange = (nextScope: QuickScopeTab) => {
    setScopeTab(nextScope);
    setCurrentPath('');
    setActiveFolderScope(null);
  };

  const handleToggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === 'stream' ? 'folder' : 'stream';
      setCurrentPath('');
      setActiveFolderScope(null);
      return next;
    });
  };

  const scrollStreamToEnd = useCallback((animated = true) => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated });
    }, 60);
  }, []);

  const handleSendText = async () => {
    const trimmed = composerText.trim();
    if (!trimmed || isSending) return;
    const utf8Bytes = getUtf8ByteLength(trimmed);
    if (utf8Bytes > MAX_TEXT_BYTES) {
      showNotice(
        '内容过长',
        `单条文本随心记不能超过 50KB（当前 ${formatBytes(utf8Bytes)}）`
      );
      return;
    }

    setIsSending(true);
    try {
      const res = await quickNotesApi.createQuickText({
        content: trimmed,
        storageType: sendStorageType,
        ttlMinutes: sendStorageType === 'temp' ? 20 : undefined,
        clientId: createQuickClientId('txt'),
      });
      if ((res.code === 200 || res.code === 201) && res.data) {
        shouldScrollToBottomRef.current = true;
        setComposerText('');
        setItems(prev => mergeQuickMemoDelta(prev, { items: [res.data] }, serverOffsetRef.current));
        void runDeltaSync();
        scrollStreamToEnd(true);
      } else {
        throw new Error(res.message || '发送失败');
      }
    } catch (err: any) {
      showNotice('发送失败', err?.message || '网络异常，请稍后重试');
    } finally {
      setIsSending(false);
    }
  };

  // 仅在用户主动点击剪贴板按钮时读取剪贴板，避免系统被动弹框干扰
  const handlePasteClipboard = async () => {
    try {
      const clipText = await Clipboard.getStringAsync();
      const cleaned = (clipText || '').trim();
      if (!cleaned) {
        showNotice('剪贴板为空', '请先复制文字或链接后再粘贴');
        return;
      }
      setComposerText(prev => (prev ? `${prev}\n${cleaned}` : cleaned));
      composerInputRef.current?.focus();
    } catch {
      showNotice('读取失败', '无法读取当前剪贴板内容');
    }
  };

  const uploadBatchFiles = async (
    batch: {
      uri: string;
      name: string;
      type: string;
      size?: number;
      file?: any;
      relativePath?: string;
      folderName?: string;
    }[]
  ) => {
    if (batch.length === 0) return;
    const oversized = batch.find(f => f.size && f.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      showNotice('文件过大', `「${oversized.name}」超过 100MB 限制`);
      return;
    }

    setIsBatchUploading(true);
    setBatchTotalCount(batch.length);
    setBatchCurrentIndex(0);

    const batchExpireAt =
      sendStorageType === 'temp'
        ? new Date(Date.now() + 20 * 60 * 1000).toISOString()
        : undefined;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < batch.length; i += 1) {
      const fileItem = batch[i];
      setBatchCurrentIndex(i + 1);
      setCurrentUploadingName(fileItem.name);
      try {
        await quickNotesApi.uploadQuickFile(
          {
            uri: fileItem.uri,
            name: fileItem.name,
            type: fileItem.type,
            file: fileItem.file,
            relativePath: fileItem.relativePath,
            folderName: fileItem.folderName,
            originalName: fileItem.name,
          },
          {
            storageType: sendStorageType,
            ttlMinutes: sendStorageType === 'temp' ? 20 : undefined,
            batchExpireAt,
            clientId: createQuickClientId('file'),
          }
        );
        successCount += 1;
      } catch (err: any) {
        console.warn(`Upload failed (${fileItem.name}):`, err?.message);
        failCount += 1;
      }
    }

    setIsBatchUploading(false);
    shouldScrollToBottomRef.current = true;
    await runDeltaSync();
    scrollStreamToEnd(true);

    if (failCount > 0) {
      showNotice('批量上传完成', `成功 ${successCount} 个，失败 ${failCount} 个`);
    }
  };

  const handlePickFromLibrary = async () => {
    setShowAttachSheet(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_UPLOAD_BYTES) {
        showNotice('上传失败', '文件超过 100MB 限制');
        return;
      }
      const fileName = asset.fileName || `memo_${Date.now()}.jpg`;
      const relPath = currentPath ? `${currentPath}/${fileName}` : undefined;
      await uploadBatchFiles([
        {
          uri: asset.uri,
          name: fileName,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
          file: (asset as any).file,
          relativePath: relPath,
          folderName: currentPath ? currentPath.split('/')[0] : undefined,
        },
      ]);
    } catch (err: any) {
      showNotice('上传失败', err?.message || '选取媒体失败');
    }
  };

  const handlePickFromDocuments = async () => {
    setShowAttachSheet(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_UPLOAD_BYTES) {
        showNotice('上传失败', '文件超过 100MB 限制');
        return;
      }
      const relPath = currentPath ? `${currentPath}/${asset.name}` : undefined;
      await uploadBatchFiles([
        {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
          size: asset.size,
          file: (asset as any).file,
          relativePath: relPath,
          folderName: currentPath ? currentPath.split('/')[0] : undefined,
        },
      ]);
    } catch (err: any) {
      showNotice('上传失败', err?.message || '选取文件失败');
    }
  };

  const handlePickFolder = () => {
    setShowAttachSheet(false);
    if (Platform.OS === 'web') {
      webFolderInputRef.current?.click();
    } else {
      setShowFolderNameModal(true);
    }
  };

  const handleWebFolderInputChange = async (e: any) => {
    const selectedFiles = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const batch = selectedFiles.map(file => {
      const rawRel = (file as any).webkitRelativePath || file.name;
      const fullRel = currentPath ? `${currentPath}/${rawRel}` : rawRel;
      const topFolder = fullRel.includes('/') ? fullRel.split('/')[0] : undefined;
      return {
        uri: '',
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        file,
        relativePath: fullRel,
        folderName: topFolder,
      };
    });

    await uploadBatchFiles(batch);
  };

  const handleNativeFolderConfirm = async (folderName: string) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const batch = result.assets.map(asset => {
        const fullRel = currentPath
          ? `${currentPath}/${folderName}/${asset.name}`
          : `${folderName}/${asset.name}`;
        return {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
          size: asset.size,
          file: (asset as any).file,
          relativePath: fullRel,
          folderName: fullRel.split('/')[0],
        };
      });

      await uploadBatchFiles(batch);
    } catch (err: any) {
      showNotice('选取失败', err?.message || '文件夹选取异常');
    }
  };

  const handleCopyItem = async (item: QuickMemoItem) => {
    const targetText =
      item.kind === 'image' || item.kind === 'file'
        ? resolveQuickMemoUrl(item.attachment?.url)
        : item.kind === 'link'
        ? item.links?.[0]?.url || item.content
        : item.content;
    if (!targetText) return;
    try {
      await Clipboard.setStringAsync(targetText);
      showNotice('已复制', item.attachment ? '文件直链已存入剪贴板' : '内容已存入剪贴板');
    } catch {
      showNotice('复制内容', targetText);
    }
  };

  const handleOpenSafeLink = (url?: string) => {
    if (!isSafeHttpUrl(url)) {
      showNotice('链接受限', '仅支持打开安全的 http/https 链接');
      return;
    }
    Linking.openURL(url!).catch(() => {
      showNotice('打开失败', '无法调起系统浏览器');
    });
  };

  const handlePromoteItem = async (item: QuickMemoItem) => {
    const id = item._id || item.id;
    try {
      const res = await quickNotesApi.promoteQuickMemo(id);
      if (res.code === 200 && res.data) {
        setItems(prev => mergeQuickMemoDelta(prev, { items: [res.data] }, serverOffsetRef.current));
        if (previewItem && (previewItem._id || previewItem.id) === id) {
          setPreviewItem(res.data);
        }
        void runDeltaSync();
      } else {
        throw new Error(res.message);
      }
    } catch (err: any) {
      showNotice('操作失败', err?.message || '转为永久失败');
    }
  };

  const handleExtendItem = async (item: QuickMemoItem) => {
    const id = item._id || item.id;
    try {
      const res = await quickNotesApi.extendQuickMemo(id);
      if (res.code === 200 && res.data) {
        setItems(prev => mergeQuickMemoDelta(prev, { items: [res.data] }, serverOffsetRef.current));
        void runDeltaSync();
      } else {
        throw new Error(res.message);
      }
    } catch (err: any) {
      showNotice('操作失败', err?.message || '续期失败');
    }
  };

  const handleDeleteItem = async (item: QuickMemoItem) => {
    const id = item._id || item.id;
    try {
      await quickNotesApi.deleteQuickMemo(id);
      setItems(prev => prev.filter(x => (x._id || x.id) !== id));
      if (previewItem && (previewItem._id || previewItem.id) === id) {
        setPreviewItem(null);
      }
      void runDeltaSync();
    } catch (err: any) {
      showNotice('删除失败', err?.message || '网络异常');
    }
  };

  const handlePressItem = (item: QuickMemoItem) => {
    if (item.kind === 'image' || item.kind === 'file') {
      setPreviewItem(item);
      return;
    }
    if (item.kind === 'link') {
      const targetUrl = item.links?.[0]?.url || item.content;
      if (isSafeHttpUrl(targetUrl)) {
        handleOpenSafeLink(targetUrl);
      } else {
        void handleCopyItem(item);
      }
      return;
    }
    void handleCopyItem(item);
  };

  const handleLongPressItem = (item: QuickMemoItem) => {
    triggerHaptic('light');
    const isTemp = item.storageType === 'temp';
    const hasFile = Boolean(item.attachment?.url);
    const primaryUrl = item.links?.[0]?.url || (item.kind === 'link' ? item.content : '');

    const sheetItems: ActionSheetItem[] = [
      {
        key: 'copy',
        label: hasFile ? '复制文件直链' : item.kind === 'link' ? '复制链接' : '复制正文',
        icon: 'copy-outline',
        onPress: () => void handleCopyItem(item),
      },
    ];

    if (isSafeHttpUrl(primaryUrl)) {
      sheetItems.push({
        key: 'open-link',
        label: '在浏览器打开链接',
        icon: 'open-outline',
        onPress: () => handleOpenSafeLink(primaryUrl),
      });
    }

    if (hasFile) {
      sheetItems.push({
        key: 'download',
        label: '预览 / 下载文件',
        icon: 'download-outline',
        onPress: () => setPreviewItem(item),
      });
    }

    if (isTemp) {
      sheetItems.push(
        {
          key: 'extend',
          label: '续期 +20 分钟',
          icon: 'time-outline',
          color: '#d97706',
          onPress: () => void handleExtendItem(item),
        },
        {
          key: 'promote',
          label: '转为永久保留',
          icon: 'bookmark-outline',
          color: '#059669',
          onPress: () => void handlePromoteItem(item),
        }
      );
    }

    sheetItems.push({
      key: 'to-note',
      label: item.convertedNoteId ? '再次转存为笔记' : '转存为正式笔记',
      icon: 'document-text-outline',
      color: accentColor,
      onPress: () => setConvertTarget(item),
    });

    if (item.convertedNoteId) {
      sheetItems.push({
        key: 'open-note',
        label: '查看已转存笔记',
        icon: 'arrow-forward-circle-outline',
        onPress: () =>
          router.push({ pathname: '/note/[id]', params: { id: item.convertedNoteId! } }),
      });
    }

    sheetItems.push({
      key: 'delete',
      label: '删除此条记录',
      icon: 'trash-outline',
      danger: true,
      dividerBefore: true,
      onPress: () => {
        confirmAction('确认删除', '确定要删除这条随心记吗？', () => handleDeleteItem(item));
      },
    });

    const sheetTitle =
      item.attachment?.originalName ||
      (item.content.length > 26 ? `${item.content.slice(0, 26)}...` : item.content) ||
      '随心记操作';

    setContextSheet({
      title: sheetTitle,
      subtitle: isTemp ? '临时 20 分钟保留' : '永久保留',
      items: sheetItems,
    });
  };

  const handleFolderLongPress = (folder: QuickVirtualFolder) => {
    triggerHaptic('light');
    const storageScope = folder.storageType;
    const hasTemp = storageScope === 'temp';

    const sheetItems: ActionSheetItem[] = [
      {
        key: 'enter',
        label: '进入文件夹',
        icon: 'folder-open-outline',
        onPress: () => {
          setCurrentPath(folder.fullPath);
          setActiveFolderScope(folder.storageType);
        },
      },
      {
        key: 'zip',
        label: '打包下载 ZIP',
        icon: 'archive-outline',
        onPress: async () => {
          try {
            const url = await quickNotesApi.getQuickFolderDownloadUrl(
              folder.topLevelFolder,
              storageScope
            );
            Linking.openURL(url).catch(() => showNotice('下载失败', '无法打开打包下载链接'));
          } catch (err: any) {
            showNotice('下载失败', err?.message || '获取下载链接失败');
          }
        },
      },
    ];

    if (hasTemp) {
      sheetItems.push({
        key: 'promote-folder',
        label: '整包转为永久',
        icon: 'bookmark-outline',
        color: '#059669',
        onPress: async () => {
          try {
            await quickNotesApi.promoteQuickFolder(folder.topLevelFolder);
            await runDeltaSync();
          } catch (err: any) {
            showNotice('操作失败', err?.message || '整包转永久失败');
          }
        },
      });
    }

    sheetItems.push({
      key: 'delete-folder',
      label: '删除文件夹',
      icon: 'trash-outline',
      danger: true,
      dividerBefore: true,
      onPress: () => {
        confirmAction(
          '确认删除文件夹',
          `确定要彻底删除文件夹「${folder.name}」内 ${folder.items.length} 个文件吗？`,
          async () => {
            try {
              await quickNotesApi.deleteQuickFolder(folder.topLevelFolder, storageScope);
              await loadFullList(true);
            } catch (err: any) {
              showNotice('删除失败', err?.message || '网络异常');
            }
          }
        );
      },
    });

    setContextSheet({
      title: folder.name,
      subtitle: `${folder.items.length} 个文件 · ${formatBytes(folder.totalSize)}`,
      items: sheetItems,
    });
  };

  const renderSkeleton = () => (
    <View style={styles.skeletonWrap}>
      {[1, 2, 3, 4].map(idx => (
        <View
          key={idx}
          style={[
            styles.skeletonCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <View style={[styles.skeletonLineLg, { backgroundColor: theme.backgroundElement }]} />
          <View style={[styles.skeletonLineMd, { backgroundColor: theme.backgroundElement }]} />
          <View style={[styles.skeletonLineSm, { backgroundColor: theme.backgroundElement }]} />
        </View>
      ))}
    </View>
  );

  const scopeButtons: { key: QuickScopeTab; label: string; count: number }[] = [
    { key: 'all', label: '全部', count: counts.all },
    { key: 'temp', label: '临时 20m', count: counts.temp },
    { key: 'permanent', label: '永久', count: counts.permanent },
  ];

  const hasTypedText = composerText.trim().length > 0;
  const defaultFolderLabel = currentPath
    ? ''
    : `资料包_${new Date().getMonth() + 1}${new Date().getDate()}`;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      {Platform.OS === 'web' && (
        <input
          ref={webFolderInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleWebFolderInputChange}
        />
      )}

      {/* 顶部分区切换 */}
      <View
        style={[
          styles.segmentContainer,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        ]}
      >
        {scopeButtons.map(btn => {
          const active = scopeTab === btn.key;
          return (
            <TouchableOpacity
              key={btn.key}
              style={[
                styles.segmentBtn,
                active && [styles.segmentBtnActive, { backgroundColor: theme.card }],
              ]}
              onPress={() => handleScopeChange(btn.key)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? theme.text : theme.textSecondary },
                  active && styles.segmentTextActive,
                ]}
              >
                {btn.label}
              </Text>
              <View
                style={[
                  styles.countBadge,
                  {
                    backgroundColor: active
                      ? isDark
                        ? 'rgba(56, 189, 248, 0.16)'
                        : '#eff6ff'
                      : theme.background,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countText,
                    { color: active ? accentColor : theme.textSecondary },
                  ]}
                >
                  {btn.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 类型过滤 / 文件夹模式切换条 */}
      <View style={styles.toolbarRow}>
        {viewMode === 'stream' ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {KIND_FILTERS.map(f => {
              const active = kindFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active
                        ? isDark
                          ? 'rgba(56, 189, 248, 0.16)'
                          : '#eff6ff'
                        : theme.card,
                      borderColor: active ? accentColor : theme.border,
                    },
                  ]}
                  onPress={() => setKindFilter(f.key)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: active ? accentColor : theme.textSecondary },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {Boolean(currentPath) && (
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
                onPress={() => {
                  const parts = currentPath.split('/');
                  parts.pop();
                  const nextPath = parts.join('/');
                  setCurrentPath(nextPath);
                  if (!nextPath) setActiveFolderScope(null);
                }}
              >
                <Ionicons name="arrow-back" size={14} color={accentColor} />
                <Text style={[styles.filterChipText, { color: accentColor }]}>上一级</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: theme.card, borderColor: theme.border }]}
              onPress={() => {
                setCurrentPath('');
                setActiveFolderScope(null);
              }}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: !currentPath ? theme.text : theme.textSecondary },
                ]}
              >
                全部目录
              </Text>
            </TouchableOpacity>
            {breadcrumbSegments.map((seg, idx) => {
              const target = breadcrumbSegments.slice(0, idx + 1).join('/');
              const isLast = idx === breadcrumbSegments.length - 1;
              return (
                <TouchableOpacity
                  key={target}
                  style={[styles.filterChip, { backgroundColor: theme.card, borderColor: theme.border }]}
                  onPress={() => !isLast && setCurrentPath(target)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      { color: isLast ? theme.text : theme.textSecondary },
                    ]}
                  >
                    {seg}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <TouchableOpacity
          style={[
            styles.modeToggleBtn,
            {
              backgroundColor:
                viewMode === 'folder'
                  ? isDark
                    ? 'rgba(56, 189, 248, 0.16)'
                    : '#eff6ff'
                  : theme.card,
              borderColor: viewMode === 'folder' ? accentColor : theme.border,
            },
          ]}
          onPress={handleToggleViewMode}
          activeOpacity={0.75}
        >
          <Ionicons
            name={viewMode === 'folder' ? 'chatbubble-ellipses-outline' : 'folder-outline'}
            size={15}
            color={viewMode === 'folder' ? accentColor : theme.textSecondary}
          />
          <Text
            style={[
              styles.modeToggleText,
              { color: viewMode === 'folder' ? accentColor : theme.textSecondary },
            ]}
          >
            {viewMode === 'folder' ? '对话流' : '文件夹'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 容量信息轻量提示 */}
      {quota.permanentUsedBytes > 0 && (
        <View style={styles.quotaBar}>
          <Text style={[styles.quotaText, { color: theme.textSecondary }]}>
            永久配额 {formatBytes(quota.permanentUsedBytes)} /{' '}
            {formatBytes(quota.permanentLimitBytes)}
          </Text>
        </View>
      )}

      {/* 主体内容区 */}
      {isLoading ? (
        renderSkeleton()
      ) : viewMode === 'stream' ? (
        <FlatList
          ref={flatListRef}
          data={filteredStreamItems}
          keyExtractor={item => item._id || item.id}
          contentContainerStyle={[
            styles.listContent,
            filteredStreamItems.length === 0 && styles.emptyListGrow,
          ]}
          renderItem={({ item }) => (
            <QuickMemoCard
              item={item}
              serverOffsetMs={serverOffsetMs}
              isTimerActive={isTimerActive}
              onPressItem={handlePressItem}
              onLongPressItem={handleLongPressItem}
              onCopyQuick={it => void handleCopyItem(it)}
              onOpenConvertedNote={noteId =>
                router.push({ pathname: '/note/[id]', params: { id: noteId } })
              }
            />
          )}
          onContentSizeChange={() => {
            if (shouldScrollToBottomRef.current && filteredStreamItems.length > 0) {
              shouldScrollToBottomRef.current = false;
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScroll={e => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            isNearBottomRef.current =
              layoutMeasurement.height + contentOffset.y >= contentSize.height - 96;
          }}
          scrollEventThrottle={120}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadFullList(true)}
              tintColor={accentColor}
              colors={['#1890ff']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="paper-plane-outline" size={32} color={theme.textSecondary} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>暂无随心记</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                输入文字、粘贴链接或选取图片文件，手机与电脑即时同步
              </Text>
            </View>
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadFullList(true)}
              tintColor={accentColor}
              colors={['#1890ff']}
            />
          }
        >
          {folderTree.folders.map(folder => (
            <TouchableOpacity
              key={folder.key}
              style={[
                styles.folderCard,
                { backgroundColor: theme.card, borderColor: theme.border },
              ]}
              onPress={() => {
                setCurrentPath(folder.fullPath);
                setActiveFolderScope(folder.storageType);
              }}
              onLongPress={() => handleFolderLongPress(folder)}
              delayLongPress={400}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.folderIconSlot,
                  {
                    backgroundColor: isDark ? 'rgba(217, 119, 6, 0.18)' : '#fef3c7',
                  },
                ]}
              >
                <Ionicons name="folder" size={22} color="#d97706" />
              </View>
              <View style={styles.folderMeta}>
                <Text style={[styles.folderTitle, { color: theme.text }]} numberOfLines={1}>
                  {folder.name}
                </Text>
                <View style={styles.folderSubRow}>
                  <Text style={[styles.folderSize, { color: theme.textSecondary }]}>
                    {folder.items.length} 个文件 · {formatBytes(folder.totalSize)}
                  </Text>
                  {folder.storageType === 'temp' ? (
                    <CountdownBadge
                      expireAt={folder.minExpireAt}
                      fallbackSeconds={folder.minRemaining}
                      serverOffsetMs={serverOffsetMs}
                      isTimerActive={isTimerActive}
                    />
                  ) : (
                    <View
                      style={[
                        styles.permFolderBadge,
                        { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.2)' : '#ecfdf5' },
                      ]}
                    >
                      <Text style={styles.permFolderText}>永久</Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
            </TouchableOpacity>
          ))}

          {folderTree.files.map(item => (
            <QuickMemoCard
              key={item._id || item.id}
              item={item}
              serverOffsetMs={serverOffsetMs}
              isTimerActive={isTimerActive}
              onPressItem={handlePressItem}
              onLongPressItem={handleLongPressItem}
              onCopyQuick={it => void handleCopyItem(it)}
              onOpenConvertedNote={noteId =>
                router.push({ pathname: '/note/[id]', params: { id: noteId } })
              }
            />
          ))}

          {folderTree.folders.length === 0 && folderTree.files.length === 0 && (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconCircle, { backgroundColor: theme.backgroundElement }]}>
                <Ionicons name="folder-open-outline" size={32} color={theme.textSecondary} />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>当前目录为空</Text>
              <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                点击左下角附件按钮上传文件或文件夹
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* 吸底快捷输入栏 */}
      <View
        style={[
          styles.composerContainer,
          { backgroundColor: theme.card, borderTopColor: theme.border },
        ]}
      >
        <View style={styles.composerTopRow}>
          <TouchableOpacity
            style={[
              styles.ttlPill,
              {
                backgroundColor:
                  sendStorageType === 'temp'
                    ? isDark
                      ? 'rgba(217, 119, 6, 0.18)'
                      : '#fef3c7'
                    : isDark
                    ? 'rgba(5, 150, 105, 0.18)'
                    : '#ecfdf5',
              },
            ]}
            onPress={() => setSendStorageType(prev => (prev === 'temp' ? 'permanent' : 'temp'))}
            hitSlop={6}
            activeOpacity={0.75}
          >
            <View
              style={[
                styles.ttlDot,
                { backgroundColor: sendStorageType === 'temp' ? '#d97706' : '#059669' },
              ]}
            />
            <Text
              style={[
                styles.ttlText,
                { color: sendStorageType === 'temp' ? '#d97706' : '#059669' },
              ]}
            >
              {sendStorageType === 'temp' ? '临时保留 · 20 分钟' : '永久保留'}
            </Text>
            <Ionicons
              name="swap-horizontal-outline"
              size={13}
              color={sendStorageType === 'temp' ? '#d97706' : '#059669'}
            />
          </TouchableOpacity>

          <Text style={[styles.composerHint, { color: theme.textSecondary }]}>
            长按卡片可操作
          </Text>
        </View>

        <View style={styles.composerInputRow}>
          <TouchableOpacity
            style={[styles.composerIconBtn, { backgroundColor: theme.backgroundElement }]}
            onPress={() => setShowAttachSheet(true)}
            disabled={isBatchUploading}
            activeOpacity={0.75}
          >
            <Ionicons name="add" size={22} color={theme.text} />
          </TouchableOpacity>

          <TextInput
            ref={composerInputRef}
            style={[
              styles.composerInput,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
              },
            ]}
            value={composerText}
            onChangeText={setComposerText}
            placeholder="输入文字或粘贴链接..."
            placeholderTextColor={theme.textSecondary}
            multiline
          />

          {hasTypedText ? (
            <TouchableOpacity
              style={[styles.sendBtn, isSending && styles.disabledBtn]}
              onPress={() => void handleSendText()}
              disabled={isSending}
              activeOpacity={0.85}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#ffffff" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.pasteBtn,
                {
                  backgroundColor: isDark ? 'rgba(56, 189, 248, 0.16)' : '#eff6ff',
                  borderColor: accentColor,
                },
              ]}
              onPress={() => void handlePasteClipboard()}
              activeOpacity={0.75}
            >
              <Ionicons name="clipboard-outline" size={18} color={accentColor} />
              <Text style={[styles.pasteBtnText, { color: accentColor }]}>粘贴</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 附件来源选择弹窗 */}
      <Modal
        visible={showAttachSheet}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowAttachSheet(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAttachSheet(false)}
        >
          <View style={[styles.attachSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            <Text style={[styles.sheetTitle, { color: theme.textSecondary }]}>
              选择附件发送（单文件上限 100MB）
            </Text>

            <TouchableOpacity
              style={[styles.sheetOption, { borderBottomColor: theme.border }]}
              onPress={() => void handlePickFromLibrary()}
            >
              <View
                style={[
                  styles.sheetIconBox,
                  { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.16)' : '#eff6ff' },
                ]}
              >
                <Ionicons name="images-outline" size={21} color={accentColor} />
              </View>
              <View style={styles.sheetOptionCol}>
                <Text style={[styles.sheetOptionPrimary, { color: theme.text }]}>从手机相册选取</Text>
                <Text style={[styles.sheetOptionSub, { color: theme.textSecondary }]}>
                  发送图片或视频
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetOption, { borderBottomColor: theme.border }]}
              onPress={() => void handlePickFromDocuments()}
            >
              <View
                style={[
                  styles.sheetIconBox,
                  { backgroundColor: isDark ? 'rgba(5, 150, 105, 0.16)' : '#ecfdf5' },
                ]}
              >
                <Ionicons name="document-text-outline" size={21} color="#059669" />
              </View>
              <View style={styles.sheetOptionCol}>
                <Text style={[styles.sheetOptionPrimary, { color: theme.text }]}>选取系统文件</Text>
                <Text style={[styles.sheetOptionSub, { color: theme.textSecondary }]}>
                  支持 PDF、文档、代码或压缩包
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.sheetOption, { borderBottomWidth: 0 }]} onPress={handlePickFolder}>
              <View
                style={[
                  styles.sheetIconBox,
                  { backgroundColor: isDark ? 'rgba(217, 119, 6, 0.16)' : '#fef3c7' },
                ]}
              >
                <Ionicons name="folder-open-outline" size={21} color="#d97706" />
              </View>
              <View style={styles.sheetOptionCol}>
                <Text style={[styles.sheetOptionPrimary, { color: theme.text }]}>上传完整文件夹</Text>
                <Text style={[styles.sheetOptionSub, { color: theme.textSecondary }]}>
                  保留目录层级，支持一键打包 ZIP
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetCancelBtn, { backgroundColor: theme.backgroundElement }]}
              onPress={() => setShowAttachSheet(false)}
            >
              <Text style={[styles.sheetCancelText, { color: theme.textSecondary }]}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 原生文件夹命名弹窗（复用 TextPromptModal） */}
      <TextPromptModal
        visible={showFolderNameModal}
        title="新建并上传文件夹"
        subtitle="请命名目录，随后将打开系统文件选择器选取多文件归入该目录"
        placeholder="例如：会议资料、设计截图..."
        defaultValue={defaultFolderLabel}
        confirmLabel="下一步：选取文件"
        onClose={() => setShowFolderNameModal(false)}
        onConfirm={value => handleNativeFolderConfirm(value)}
      />

      {/* 批量上传进度遮罩 */}
      <Modal visible={isBatchUploading} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.progressOverlay}>
          <View style={[styles.progressCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <ActivityIndicator size="large" color={accentColor} />
            <Text style={[styles.progressTitle, { color: theme.text }]}>
              正在上传 ({batchCurrentIndex} / {batchTotalCount})
            </Text>
            <Text style={[styles.progressSub, { color: accentColor }]} numberOfLines={1}>
              {currentUploadingName}
            </Text>
          </View>
        </View>
      </Modal>

      {/* 全屏媒体与文本预览 */}
      <FilePreviewModal
        visible={Boolean(previewItem)}
        file={previewItem as PreviewableFile | null}
        serverOffsetMs={serverOffsetMs}
        onClose={() => setPreviewItem(null)}
        onPromote={f => void handlePromoteItem(f as QuickMemoItem)}
        onConvertToNote={f => {
          setPreviewItem(null);
          setConvertTarget(f as QuickMemoItem);
        }}
      />

      {/* 一键转存为正式笔记弹窗 */}
      <QuickNoteConvertModal
        visible={Boolean(convertTarget)}
        item={convertTarget}
        onClose={() => setConvertTarget(null)}
        onConverted={(updatedMemo, createdNote) => {
          setItems(prev =>
            mergeQuickMemoDelta(prev, { items: [updatedMemo] }, serverOffsetRef.current)
          );
          showNotice('已转存为笔记', `已保存至《${createdNote.title}》`);
        }}
      />

      {/* 400ms 长按上下文动作面板 */}
      <ActionContextSheet
        visible={Boolean(contextSheet)}
        title={contextSheet?.title}
        subtitle={contextSheet?.subtitle}
        items={contextSheet?.items || []}
        onClose={() => setContextSheet(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  segmentContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    borderRadius: 8,
    gap: 5,
  },
  segmentBtnActive: {
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
  },
  segmentTextActive: {
    fontWeight: '700',
  },
  countBadge: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: MONO_FONT,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  modeToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  quotaBar: {
    paddingHorizontal: 18,
    marginBottom: 6,
  },
  quotaText: {
    fontSize: 11,
    fontFamily: MONO_FONT,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
  },
  emptyListGrow: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  skeletonWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  skeletonCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  skeletonLineLg: {
    height: 14,
    width: '78%',
    borderRadius: 6,
  },
  skeletonLineMd: {
    height: 12,
    width: '52%',
    borderRadius: 6,
  },
  skeletonLineSm: {
    height: 10,
    width: '28%',
    borderRadius: 5,
  },
  folderCard: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    gap: 12,
  },
  folderIconSlot: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderMeta: {
    flex: 1,
    gap: 4,
  },
  folderTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  folderSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  folderSize: {
    fontSize: 12,
    fontFamily: MONO_FONT,
  },
  permFolderBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  permFolderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
    fontFamily: MONO_FONT,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 28,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  composerContainer: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  composerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  ttlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    minHeight: 30,
    borderRadius: 15,
  },
  ttlDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  ttlText: {
    fontSize: 12,
    fontWeight: '600',
  },
  composerHint: {
    fontSize: 11,
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 104,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 11 : 10,
    paddingBottom: Platform.OS === 'ios' ? 11 : 10,
    fontSize: 15,
    lineHeight: 20,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteBtn: {
    minWidth: 64,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pasteBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  attachSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 32 : 18,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sheetOptionCol: {
    flex: 1,
    gap: 2,
  },
  sheetOptionPrimary: {
    fontSize: 15,
    fontWeight: '600',
  },
  sheetOptionSub: {
    fontSize: 12,
  },
  sheetCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    marginTop: 10,
    borderRadius: 12,
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  progressOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  progressCard: {
    width: '100%',
    maxWidth: 300,
    borderRadius: 16,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    gap: 10,
  },
  progressTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  progressSub: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
