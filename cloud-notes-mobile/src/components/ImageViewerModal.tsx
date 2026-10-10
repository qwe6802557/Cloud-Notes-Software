import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Image as RNImage,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export interface ImageViewerModalProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 单张手势缩放幻灯片：自适应高保真渲染，支持长图展开、垂直滚动阅读与全景缩放
 */
function ZoomableImageSlide({
  uri,
  isActive,
  onToggleControls,
  onZoomChange,
}: {
  uri: string;
  isActive: boolean;
  onToggleControls: () => void;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const [imgRatio, setImgRatio] = useState<number>(1);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // 共享手势动画值
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // 获取真实图片尺寸比
  useEffect(() => {
    if (!uri) return;
    setLoading(true);
    setHasError(false);
    RNImage.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          setImgRatio(h / w);
        }
      },
      () => {
        setHasError(true);
        setLoading(false);
      }
    );
  }, [uri]);

  const isLong = imgRatio > 1.6;
  const rawHeight = Math.round(SCREEN_WIDTH * imgRatio);
  const displayHeight = isLong ? Math.min(rawHeight, 3800) : SCREEN_HEIGHT;
  const displayWidth = SCREEN_WIDTH;
  const initialTopOffsetY = isLong && displayHeight > SCREEN_HEIGHT
    ? (displayHeight - SCREEN_HEIGHT) / 2
    : 0;

  // 滑动切走时重置；长图激活时初始平滑对齐顶端
  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      savedTranslateX.value = 0;
      translateY.value = initialTopOffsetY;
      savedTranslateY.value = initialTopOffsetY;
    } else {
      translateY.value = initialTopOffsetY;
      savedTranslateY.value = initialTopOffsetY;
    }
  }, [isActive, initialTopOffsetY]);

  const maxZoom = isLong ? Math.max(3.8, Math.min(imgRatio * 1.6, 6.0)) : 4.0;
  const doubleTapTargetScale = 2.5;

  // 双击手势：1x 与放大之间平滑切换
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (scale.value > 1.15) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        savedTranslateX.value = 0;
        translateY.value = withSpring(initialTopOffsetY);
        savedTranslateY.value = initialTopOffsetY;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withSpring(doubleTapTargetScale);
        savedScale.value = doubleTapTargetScale;
        runOnJS(onZoomChange)(true);
      }
    });

  // 单击手势：轻触切换顶底栏显隐
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(onToggleControls)();
    });

  // 双指捏合无级缩放手势 (1x ~ maxZoom)
  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      const nextScale = savedScale.value * e.scale;
      scale.value = Math.max(0.85, Math.min(nextScale, maxZoom + 0.5));
      if (scale.value > 1.05) {
        runOnJS(onZoomChange)(true);
      }
    })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        savedTranslateX.value = 0;
        const targetY = isLong
          ? Math.min(Math.max(translateY.value, -initialTopOffsetY), initialTopOffsetY)
          : 0;
        translateY.value = withSpring(targetY);
        savedTranslateY.value = targetY;
        runOnJS(onZoomChange)(false);
      } else if (scale.value > maxZoom) {
        scale.value = withSpring(maxZoom);
        savedScale.value = maxZoom;
      } else {
        savedScale.value = scale.value;
      }
    });

  // 拖拽平移手势：放大状态下全方位拖拽；长图在 1x 状态下支持垂直顺畅阅读滑动
  const panGesture = Gesture.Pan()
    .averageTouches(true)
    .onUpdate(e => {
      if (scale.value > 1.05) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      } else if (isLong && displayHeight > SCREEN_HEIGHT) {
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      const maxTx = scale.value > 1.05 ? ((scale.value - 1) * SCREEN_WIDTH) / 2 : 0;
      const maxTy = isLong
        ? Math.max(initialTopOffsetY, (displayHeight * scale.value - SCREEN_HEIGHT) / 2)
        : ((scale.value - 1) * SCREEN_HEIGHT) / 2;

      if (Math.abs(translateX.value) > maxTx + 30) {
        translateX.value = withSpring(Math.sign(translateX.value) * maxTx);
        savedTranslateX.value = Math.sign(translateX.value) * maxTx;
      } else {
        savedTranslateX.value = translateX.value;
      }

      if (Math.abs(translateY.value) > maxTy + 40) {
        translateY.value = withSpring(Math.sign(translateY.value) * maxTy);
        savedTranslateY.value = Math.sign(translateY.value) * maxTy;
      } else {
        savedTranslateY.value = translateY.value;
      }
    });

  const taps = Gesture.Exclusive(doubleTapGesture, singleTapGesture);
  const pinchAndPan = Gesture.Simultaneous(pinchGesture, panGesture);
  const composedGesture = Gesture.Simultaneous(taps, pinchAndPan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.slideContainer}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.imageWrapper, animatedStyle]}>
          <Image
            source={{ uri }}
            style={{
              width: displayWidth,
              height: displayHeight,
            }}
            contentFit={isLong ? 'cover' : 'contain'}
            allowDownscaling={false}
            priority="high"
            transition={150}
            onLoad={e => {
              if (e.source.width > 0 && e.source.height > 0) {
                setImgRatio(e.source.height / e.source.width);
              }
              setLoading(false);
            }}
            onLoadStart={() => {
              setLoading(true);
              setHasError(false);
            }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setHasError(true);
            }}
          />
        </Animated.View>
      </GestureDetector>
      {loading && !hasError && (
        <View style={styles.stateOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#1890ff" />
        </View>
      )}
      {hasError && (
        <View style={styles.stateOverlay} pointerEvents="none">
          <Ionicons name="image-outline" size={44} color="#64748b" />
          <Text style={styles.errorText}>图片加载失败</Text>
        </View>
      )}
    </View>
  );
}

export default function ImageViewerModal({
  visible,
  images,
  initialIndex = 0,
  onClose,
}: ImageViewerModalProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [copied, setCopied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isAnyZoomed, setIsAnyZoomed] = useState(false);
  const flatListRef = useRef<FlatList<string>>(null);

  const topPadding = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0
  );

  useEffect(() => {
    if (visible) {
      const targetIdx = Math.max(0, Math.min(initialIndex, images.length - 1));
      setCurrentIndex(targetIdx);
      setIsAnyZoomed(false);
      setShowControls(true);
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: targetIdx, animated: false });
      }, 50);
    }
  }, [visible, initialIndex, images.length]);

  const handleToggleControls = useCallback(() => {
    setShowControls(prev => !prev);
  }, []);

  const handleZoomChange = useCallback((zoomed: boolean) => {
    setIsAnyZoomed(zoomed);
  }, []);

  const handleCopyLink = async () => {
    const currentUrl = images[currentIndex];
    if (!currentUrl) return;
    await Clipboard.setStringAsync(currentUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveImage = async () => {
    const currentUrl = images[currentIndex];
    if (!currentUrl) return;

    try {
      setIsSaving(true);
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = currentUrl;
        a.download = `image-${Date.now()}.png`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        Alert.alert('提示', '已发起图片下载');
        return;
      }

      const fileExt = currentUrl.split('.').pop()?.split('?')[0] || 'jpg';
      const targetFilename = `note_image_${Date.now()}.${fileExt}`;
      const targetPath = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${targetFilename}`;

      await FileSystem.downloadAsync(currentUrl, targetPath);
      Alert.alert('保存成功', `图片已保存至本地：\n${targetFilename}`);
    } catch (e: any) {
      Alert.alert('保存失败', e.message || '网络连接超时或无法写入本地存储');
    } finally {
      setIsSaving(false);
    }
  };

  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => {
      return (
        <ZoomableImageSlide
          uri={item}
          isActive={index === currentIndex}
          onToggleControls={handleToggleControls}
          onZoomChange={handleZoomChange}
        />
      );
    },
    [currentIndex, handleToggleControls, handleZoomChange]
  );

  if (!visible || images.length === 0) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent />
      <GestureHandlerRootView style={styles.container}>
        {/* 核心横向多图轮播区 */}
        <FlatList
          ref={flatListRef}
          data={images}
          keyExtractor={(item, idx) => `${item}_${idx}`}
          horizontal
          pagingEnabled
          scrollEnabled={!isAnyZoomed} // 放大状态下锁定左右翻页，专注看细节
          showsHorizontalScrollIndicator={false}
          renderItem={renderItem}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: SCREEN_WIDTH,
            offset: SCREEN_WIDTH * index,
            index,
          })}
          onMomentumScrollEnd={e => {
            const newIdx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            if (newIdx >= 0 && newIdx < images.length) {
              setCurrentIndex(newIdx);
            }
          }}
        />

        {/* 顶底浮动控制层：后置渲染 + elevation 保证在 Android 原生视图树中拥有最高层级，绝对不会被图片覆盖 */}
        <View style={styles.overlayControls} pointerEvents="box-none">
          {showControls && (
            <>
              {/* 顶部控制栏 */}
              <View style={[styles.topBar, { top: topPadding + 10 }]} pointerEvents="box-none">
                <View style={styles.counterPill}>
                  <Text style={styles.counterText}>
                    {currentIndex + 1} / {images.length}
                  </Text>
                </View>

                <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
                  <Ionicons name="close" size={24} color="#ffffff" />
                </TouchableOpacity>
              </View>

              {/* 底部操作胶囊栏 */}
              <View style={[styles.bottomBar, { bottom: Math.max(insets.bottom, 16) + 10 }]}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleCopyLink}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={copied ? 'checkmark' : 'copy-outline'}
                    size={18}
                    color={copied ? '#10b981' : '#ffffff'}
                  />
                  <Text style={[styles.actionBtnText, copied && { color: '#10b981' }]}>
                    {copied ? '已复制链接' : '复制链接'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleSaveImage}
                  disabled={isSaving}
                  activeOpacity={0.7}
                >
                  {isSaving ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Ionicons name="download-outline" size={18} color="#ffffff" />
                  )}
                  <Text style={styles.actionBtnText}>{isSaving ? '正在保存...' : '保存图片'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  slideContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  imageWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayControls: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 99,
  },
  topBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 9999,
    elevation: 99,
  },
  counterPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  counterText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 9999,
    elevation: 99,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  stateOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorText: {
    color: '#94a3b8',
    fontSize: 13,
  },
});
