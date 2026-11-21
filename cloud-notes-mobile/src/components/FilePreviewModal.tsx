import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { StashFile } from '../api/stashApi';
import { QuickMemoItem, resolveQuickMemoUrl } from '../api/quickNotesApi';
import {
  computeRemainingSeconds,
  formatBytes,
  formatCountdown,
  isSafeHttpUrl,
} from '../utils/quickNoteHelper';

export type PreviewableFile = StashFile | QuickMemoItem;

export interface FilePreviewModalProps {
  visible: boolean;
  file: PreviewableFile | null;
  serverOffsetMs?: number;
  onClose: () => void;
  onPromote?: (file: PreviewableFile) => void;
  onConvertToNote?: (file: PreviewableFile) => void;
}

interface NormalizedPreviewMeta {
  originalName: string;
  size: number;
  mimetype: string;
  url: string;
  storageType: 'temp' | 'permanent';
  expireAt: string | null;
  remainingSeconds: number | null;
  convertedNoteId: string | null;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function normalizePreviewMeta(file: PreviewableFile): NormalizedPreviewMeta {
  if ('attachment' in file) {
    const att = file.attachment;
    return {
      originalName: att?.originalName || att?.filename || '未命名文件',
      size: att?.size || 0,
      mimetype: att?.mimetype || 'application/octet-stream',
      url: resolveQuickMemoUrl(att?.url),
      storageType: file.storageType,
      expireAt: file.expireAt,
      remainingSeconds: file.remainingSeconds,
      convertedNoteId: file.convertedNoteId,
    };
  }
  return {
    originalName: file.originalName || file.filename || '未命名文件',
    size: file.size || 0,
    mimetype: file.mimetype || 'application/octet-stream',
    url: resolveQuickMemoUrl(file.url),
    storageType: file.storageType,
    expireAt: file.expireAt,
    remainingSeconds: file.remainingSeconds,
    convertedNoteId: null,
  };
}

/**
 * 判断文件预览门类
 */
const getFileCategory = (filename = '', mimetype = '') => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) ||
    mimetype.startsWith('image/')
  ) {
    return 'image';
  }
  if (
    [
      'txt',
      'md',
      'json',
      'js',
      'ts',
      'tsx',
      'py',
      'html',
      'css',
      'less',
      'java',
      'c',
      'cpp',
      'sql',
      'sh',
      'yaml',
      'yml',
      'xml',
      'log',
    ].includes(ext) ||
    mimetype.startsWith('text/')
  ) {
    return 'text';
  }
  if (['mp4', 'mov', 'webm', 'm4v', 'avi'].includes(ext) || mimetype.startsWith('video/')) {
    return 'video';
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext) || mimetype.startsWith('audio/')) {
    return 'audio';
  }
  if (ext === 'pdf' || mimetype.includes('pdf')) {
    return 'pdf';
  }
  return 'unsupported';
};

/**
 * 移动端手势缩放图片幻灯片
 */
function ZoomableImage({ uri }: { uri: string }) {
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.max(0.8, Math.min(savedScale.value * e.scale, 5));
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        savedTranslateX.value = 0;
        translateY.value = withSpring(0);
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .averageTouches(true)
    .onUpdate(e => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1.2) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        savedTranslateX.value = 0;
        translateY.value = withSpring(0);
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
      }
    });

  const composedGesture = Gesture.Race(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture)
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.imageStageContainer}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.imageWrapper, animatedStyle]}>
          <Image
            source={{ uri }}
            style={styles.fullImage}
            contentFit="contain"
            onLoadStart={() => {
              setLoading(true);
              setHasError(false);
            }}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        </Animated.View>
      </GestureDetector>

      {loading && !hasError && (
        <View style={styles.centerOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>正在载入原图...</Text>
        </View>
      )}

      {hasError && (
        <View style={styles.centerOverlay} pointerEvents="none">
          <Ionicons name="image-outline" size={48} color="#64748b" />
          <Text style={styles.errorText}>图片加载失败</Text>
        </View>
      )}
    </View>
  );
}

export default function FilePreviewModal({
  visible,
  file,
  serverOffsetMs = 0,
  onClose,
  onPromote,
  onConvertToNote,
}: FilePreviewModalProps) {
  const insets = useSafeAreaInsets();
  const [textState, setTextState] = useState<{
    url: string;
    content: string;
    error: boolean;
  }>({ url: '', content: '', error: false });

  const meta = file ? normalizePreviewMeta(file) : null;
  const category = meta ? getFileCategory(meta.originalName, meta.mimetype) : 'unsupported';
  const isTemp = meta?.storageType === 'temp';
  const targetUrl = meta?.url || '';
  const shouldLoadText = Boolean(visible && targetUrl && category === 'text');
  const textLoading = shouldLoadText && textState.url !== targetUrl;
  const textError = shouldLoadText && textState.url === targetUrl && textState.error;
  const textContent = shouldLoadText && textState.url === targetUrl ? textState.content : '';

  useEffect(() => {
    if (!shouldLoadText) return;

    let isMounted = true;
    fetch(targetUrl)
      .then(res => {
        if (!res.ok) throw new Error('网络异常');
        return res.text();
      })
      .then(text => {
        if (!isMounted) return;
        const MAX_CHARS = 100000;
        const trimmed =
          text.length > MAX_CHARS
            ? `${text.slice(0, MAX_CHARS)}\n\n/* --- 文件过长，已截断显示前 10 万字符 --- */`
            : text;
        setTextState({ url: targetUrl, content: trimmed, error: false });
      })
      .catch(() => {
        if (isMounted) {
          setTextState({ url: targetUrl, content: '', error: true });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [shouldLoadText, targetUrl]);

  const handleCopyUrl = async () => {
    if (!meta?.url) return;
    try {
      await Clipboard.setStringAsync(meta.url);
      Alert.alert('复制成功', '文件直链已复制到剪贴板');
    } catch {
      Alert.alert('文件链接', meta.url);
    }
  };

  const handleCopyText = async () => {
    if (!textContent) return;
    try {
      await Clipboard.setStringAsync(textContent);
      Alert.alert('提示', '文本内容已复制');
    } catch {
      Alert.alert('提示', '复制失败');
    }
  };

  const handleOpenExternally = () => {
    if (!meta?.url || !isSafeHttpUrl(meta.url)) {
      Alert.alert('提示', '无效的文件下载链接');
      return;
    }
    Linking.openURL(meta.url).catch(() => {
      Alert.alert('打开失败', '无法打开此文件链接');
    });
  };

  if (!file || !meta) return null;

  const remaining = isTemp
    ? computeRemainingSeconds(meta.expireAt, serverOffsetMs) ?? meta.remainingSeconds
    : null;
  const tempBadgeLabel =
    remaining !== null ? `临时 · 剩余 ${formatCountdown(remaining)}` : '临时保存';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.modalRoot}>
        {/* 顶部沉浸工具条 */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={22} color="#f8fafc" />
          </TouchableOpacity>

          <View style={styles.titleCol}>
            <Text style={styles.titleText} numberOfLines={1} ellipsizeMode="middle">
              {meta.originalName}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{formatBytes(meta.size)}</Text>
              <View style={[styles.statusPill, isTemp ? styles.tempPill : styles.permPill]}>
                <Text style={[styles.statusText, isTemp ? styles.tempText : styles.permText]}>
                  {isTemp ? tempBadgeLabel : '永久'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRightCluster}>
            <TouchableOpacity style={styles.iconBtn} onPress={handleCopyUrl} activeOpacity={0.7}>
              <Ionicons name="copy-outline" size={19} color="#f8fafc" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={handleOpenExternally}
              activeOpacity={0.7}
            >
              <Ionicons name="cloud-download-outline" size={20} color="#f8fafc" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 主视口区域 */}
        <View style={styles.viewport}>
          {category === 'image' && <ZoomableImage uri={meta.url} />}

          {category === 'text' && (
            <View style={styles.textStage}>
              <View style={styles.textSubHeader}>
                <Text style={styles.codeExtTag}>
                  {meta.originalName.split('.').pop()?.toUpperCase() || 'TXT'}
                </Text>
                <TouchableOpacity style={styles.copyTextBtn} onPress={handleCopyText}>
                  <Ionicons name="copy-outline" size={14} color="#38bdf8" />
                  <Text style={styles.copyTextBtnText}>复制文本</Text>
                </TouchableOpacity>
              </View>
              {textLoading ? (
                <View style={styles.centerOverlay}>
                  <ActivityIndicator size="large" color="#38bdf8" />
                  <Text style={styles.loadingText}>正在载入文本...</Text>
                </View>
              ) : textError ? (
                <View style={styles.centerOverlay}>
                  <Text style={styles.errorText}>文本拉取失败，请检查网络</Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.textScrollView}
                  contentContainerStyle={styles.textContentContainer}
                >
                  <Text style={styles.codeText} selectable>
                    {textContent}
                  </Text>
                </ScrollView>
              )}
            </View>
          )}

          {['video', 'audio', 'pdf', 'unsupported'].includes(category) && (
            <View style={styles.cardStage}>
              <View style={styles.infoCard}>
                <View style={styles.infoCardIcon}>
                  <Ionicons
                    name={
                      category === 'video'
                        ? 'videocam-outline'
                        : category === 'audio'
                        ? 'musical-notes-outline'
                        : category === 'pdf'
                        ? 'document-text-outline'
                        : 'document-outline'
                    }
                    size={44}
                    color="#38bdf8"
                  />
                </View>
                <Text style={styles.infoCardTitle} numberOfLines={2}>
                  {meta.originalName}
                </Text>
                <Text style={styles.infoCardSub}>
                  {category === 'video'
                    ? '视频文件 · 可调用系统播放器打开'
                    : category === 'audio'
                    ? '音频文件 · 可调用系统播放器打开'
                    : category === 'pdf'
                    ? 'PDF 文档 · 可调用系统查看器打开'
                    : '二进制文件 · 支持直接下载到本地'}
                </Text>

                <View style={styles.infoCardTable}>
                  <View style={styles.tableRow}>
                    <Text style={styles.tableKey}>文件体积</Text>
                    <Text style={styles.tableVal}>{formatBytes(meta.size)}</Text>
                  </View>
                  <View style={styles.tableRow}>
                    <Text style={styles.tableKey}>保留状态</Text>
                    <Text style={styles.tableVal}>{isTemp ? tempBadgeLabel : '永久保留'}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.cardPrimaryBtn}
                  onPress={handleOpenExternally}
                  activeOpacity={0.8}
                >
                  <Ionicons name="open-outline" size={18} color="#ffffff" />
                  <Text style={styles.cardPrimaryBtnText}>在系统应用中打开 / 下载</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* 底部悬浮动作条 */}
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.bottomActionBtn} onPress={handleCopyUrl} activeOpacity={0.75}>
            <Ionicons name="copy-outline" size={16} color="#f8fafc" />
            <Text style={styles.bottomActionText}>复制直链</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.bottomActionBtn}
            onPress={handleOpenExternally}
            activeOpacity={0.75}
          >
            <Ionicons name="download-outline" size={16} color="#f8fafc" />
            <Text style={styles.bottomActionText}>下载</Text>
          </TouchableOpacity>

          {isTemp && onPromote && (
            <TouchableOpacity
              style={[styles.bottomActionBtn, styles.promoteBtn]}
              onPress={() => onPromote(file)}
              activeOpacity={0.75}
            >
              <Ionicons name="bookmark-outline" size={16} color="#d97706" />
              <Text style={[styles.bottomActionText, { color: '#fbbf24' }]}>转永久</Text>
            </TouchableOpacity>
          )}

          {onConvertToNote && (
            <TouchableOpacity
              style={[styles.bottomActionBtn, styles.convertBtn]}
              onPress={() => onConvertToNote(file)}
              activeOpacity={0.75}
            >
              <Ionicons name="document-text-outline" size={16} color="#38bdf8" />
              <Text style={[styles.bottomActionText, { color: '#38bdf8' }]}>
                {meta.convertedNoteId ? '再存笔记' : '转存笔记'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.97)',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 10,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  titleCol: {
    flex: 1,
    marginHorizontal: 10,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f8fafc',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  metaText: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tempPill: {
    backgroundColor: 'rgba(217, 119, 6, 0.22)',
  },
  permPill: {
    backgroundColor: 'rgba(5, 150, 105, 0.22)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tempText: {
    color: '#fbbf24',
  },
  permText: {
    color: '#34d399',
  },
  headerRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewport: {
    flex: 1,
  },
  imageStageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 14,
  },
  textStage: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  textSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 8,
  },
  codeExtTag: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  copyTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 12,
    minHeight: 36,
    borderRadius: 12,
  },
  copyTextBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  textScrollView: {
    flex: 1,
  },
  textContentContainer: {
    paddingBottom: 24,
  },
  codeText: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  infoCard: {
    width: '100%',
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  infoCardIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 8,
  },
  infoCardSub: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  infoCardTable: {
    width: '100%',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
    gap: 8,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tableKey: {
    fontSize: 12,
    color: '#94a3b8',
  },
  tableVal: {
    fontSize: 12,
    color: '#e2e8f0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cardPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1890ff',
    paddingHorizontal: 20,
    minHeight: 46,
    borderRadius: 23,
  },
  cardPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 14,
    minHeight: 44,
    borderRadius: 22,
  },
  promoteBtn: {
    backgroundColor: 'rgba(217, 119, 6, 0.18)',
  },
  convertBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
  },
  bottomActionText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
});
