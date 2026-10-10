import React, { useCallback, useEffect, useState } from 'react';
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

export interface FilePreviewModalProps {
  visible: boolean;
  file: StashFile | null;
  onClose: () => void;
  onPromote?: (file: StashFile) => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 格式化字节体积
 */
const formatBytes = (bytes: number = 0, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * 判断文件预览门类
 */
const getFileCategory = (filename: string = '', mimetype: string = '') => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimetype.startsWith('image/')) {
    return 'image';
  }
  if (
    ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'py', 'html', 'css', 'less', 'java', 'c', 'cpp', 'sql', 'sh', 'yaml', 'yml', 'xml', 'log'].includes(ext) ||
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

  // 双指捏合手势
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

  // 拖拽平移手势
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

  // 双击快速缩放
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

  const composedGesture = Gesture.Race(doubleTapGesture, Gesture.Simultaneous(pinchGesture, panGesture));

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
          <ActivityIndicator size="large" color="#1890ff" />
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
  onClose,
  onPromote,
}: FilePreviewModalProps) {
  const insets = useSafeAreaInsets();
  const [textContent, setTextContent] = useState('');
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState(false);
  const [copied, setCopied] = useState(false);

  const category = file ? getFileCategory(file.originalName, file.mimetype) : 'unsupported';
  const isTemp = file?.storageType === 'temp';

  // 异步获取代码与纯文本内容
  useEffect(() => {
    if (!visible || !file?.url || category !== 'text') {
      setTextContent('');
      return;
    }

    let isMounted = true;
    setTextLoading(true);
    setTextError(false);

    fetch(file.url)
      .then(res => {
        if (!res.ok) throw new Error('网络异常');
        return res.text();
      })
      .then(text => {
        if (!isMounted) return;
        const MAX_CHARS = 100000;
        if (text.length > MAX_CHARS) {
          setTextContent(text.slice(0, MAX_CHARS) + '\n\n/* --- 文件过长，已截断显示前 10 万字符 --- */');
        } else {
          setTextContent(text);
        }
      })
      .catch(() => {
        if (isMounted) setTextError(true);
      })
      .finally(() => {
        if (isMounted) setTextLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [visible, file?.url, category]);

  // 复制直链
  const handleCopyUrl = async () => {
    if (!file?.url) return;
    try {
      await Clipboard.setStringAsync(file.url);
      setCopied(true);
      Alert.alert('复制成功', '文件直链已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert('文件链接', file.url);
    }
  };

  // 复制代码文本
  const handleCopyText = async () => {
    if (!textContent) return;
    try {
      await Clipboard.setStringAsync(textContent);
      Alert.alert('提示', '文本内容已复制');
    } catch {
      Alert.alert('提示', '复制失败');
    }
  };

  // 打开直链/下载
  const handleOpenExternally = () => {
    if (!file?.url) return;
    Linking.openURL(file.url).catch(() => {
      Alert.alert('打开失败', '无法打开此文件链接');
    });
  };

  // 升级为永久保存
  const handlePromoteFile = () => {
    if (file && onPromote) {
      onPromote(file);
    }
  };

  if (!file) return null;

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
            <Ionicons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>

          <View style={styles.titleCol}>
            <Text style={styles.titleText} numberOfLines={1} ellipsizeMode="middle">
              {file.originalName}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{formatBytes(file.size)}</Text>
              <View style={[styles.statusPill, isTemp ? styles.tempPill : styles.permPill]}>
                <Text style={[styles.statusText, isTemp ? styles.tempText : styles.permText]}>
                  {isTemp ? '临时' : '永久'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRightCluster}>
            <TouchableOpacity style={styles.iconBtn} onPress={handleCopyUrl} activeOpacity={0.7}>
              <Ionicons name="copy-outline" size={20} color="#ffffff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={handleOpenExternally} activeOpacity={0.7}>
              <Ionicons name="cloud-download-outline" size={21} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 主视口区域 */}
        <View style={styles.viewport}>
          {category === 'image' && <ZoomableImage uri={file.url} />}

          {category === 'text' && (
            <View style={styles.textStage}>
              <View style={styles.textSubHeader}>
                <Text style={styles.codeExtTag}>
                  {file.originalName.split('.').pop()?.toUpperCase() || 'TXT'}
                </Text>
                <TouchableOpacity style={styles.copyTextBtn} onPress={handleCopyText}>
                  <Ionicons name="copy-outline" size={14} color="#38bdf8" />
                  <Text style={styles.copyTextBtnText}>复制代码</Text>
                </TouchableOpacity>
              </View>
              {textLoading ? (
                <View style={styles.centerOverlay}>
                  <ActivityIndicator size="large" color="#1890ff" />
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
                    size={48}
                    color="#38bdf8"
                  />
                </View>
                <Text style={styles.infoCardTitle} numberOfLines={2}>
                  {file.originalName}
                </Text>
                <Text style={styles.infoCardSub}>
                  {category === 'video'
                    ? '视频文件 · 点击下方按钮唤起系统播放器'
                    : category === 'audio'
                    ? '音频文件 · 点击下方按钮唤起系统播放器'
                    : category === 'pdf'
                    ? 'PDF 文档 · 点击下方按钮直接查看'
                    : '二进制专有格式 · 支持直接下载到手机本地'}
                </Text>

                <View style={styles.infoCardTable}>
                  <View style={styles.tableRow}>
                    <Text style={styles.tableKey}>文件体积</Text>
                    <Text style={styles.tableVal}>{formatBytes(file.size)}</Text>
                  </View>
                  <View style={styles.tableRow}>
                    <Text style={styles.tableKey}>存储模式</Text>
                    <Text style={styles.tableVal}>{isTemp ? '临时保存 (10分钟)' : '永久保存'}</Text>
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
            <Ionicons name="copy-outline" size={16} color="#ffffff" />
            <Text style={styles.bottomActionText}>复制直链</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.bottomActionBtn} onPress={handleOpenExternally} activeOpacity={0.75}>
            <Ionicons name="download-outline" size={16} color="#ffffff" />
            <Text style={styles.bottomActionText}>打开 / 下载</Text>
          </TouchableOpacity>

          {isTemp && onPromote && (
            <TouchableOpacity
              style={[styles.bottomActionBtn, styles.promoteBtn]}
              onPress={handlePromoteFile}
              activeOpacity={0.75}
            >
              <Ionicons name="bookmark-outline" size={16} color="#f59e0b" />
              <Text style={[styles.bottomActionText, { color: '#f59e0b' }]}>转永久</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 10,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  titleCol: {
    flex: 1,
    marginHorizontal: 12,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
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
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  permPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  tempText: {
    color: '#f59e0b',
  },
  permText: {
    color: '#10b981',
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
    paddingHorizontal: 10,
    paddingVertical: 4,
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
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  infoCardIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
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
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 8,
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
    color: '#64748b',
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
    paddingVertical: 12,
    borderRadius: 22,
  },
  cardPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  bottomActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  promoteBtn: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  bottomActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
