import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
  withTiming,
} from 'react-native-reanimated';

export interface ImageViewerModalProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * 单张可手势缩放、长图自动适配与双击放大的幻灯片组件
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
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const [isLongImage, setIsLongImage] = useState(false);

  // 共享手势动画值
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  // 获取真实图片尺寸以识别长图
  useEffect(() => {
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => {
        if (w > 0 && h > 0) {
          setImgSize({ width: w, height: h });
          const ratio = h / w;
          setIsLongImage(ratio > 1.6);
        }
      },
      () => {
        setImgSize({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.7 });
      }
    );
  }, [uri]);

  // 当滑动到其他图片时，重置当前图片的缩放状态
  useEffect(() => {
    if (!isActive) {
      scale.value = 1;
      savedScale.value = 1;
      translateX.value = 0;
      savedTranslateX.value = 0;
      translateY.value = 0;
      savedTranslateY.value = 0;
    }
  }, [isActive]);

  // 双击手势：1x 与 2.5x 之间平滑切换
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd(() => {
      if (scale.value > 1.15) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        translateX.value = withSpring(0);
        savedTranslateX.value = 0;
        translateY.value = withSpring(0);
        savedTranslateY.value = 0;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  // 单击手势：轻触切换顶底栏显隐
  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(onToggleControls)();
    });

  // 双指捏合无级缩放手势 (1x ~ 4x)
  const pinchGesture = Gesture.Pinch()
    .onUpdate(e => {
      const nextScale = savedScale.value * e.scale;
      scale.value = Math.max(0.8, Math.min(nextScale, 4.5));
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
        translateY.value = withSpring(0);
        savedTranslateY.value = 0;
        runOnJS(onZoomChange)(false);
      } else if (scale.value > 4) {
        scale.value = withSpring(4);
        savedScale.value = 4;
      } else {
        savedScale.value = scale.value;
      }
    });

  // 拖拽平移手势：仅在放大时响应任意拖动并支持回弹
  const panGesture = Gesture.Pan()
    .averageTouches(true)
    .onUpdate(e => {
      if (scale.value > 1.05) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      if (scale.value > 1.05) {
        // 限制拖拽边界，防止图片飞出可视区域
        const maxTx = ((scale.value - 1) * SCREEN_WIDTH) / 2;
        const maxTy = ((scale.value - 1) * SCREEN_HEIGHT) / 2;

        if (Math.abs(translateX.value) > maxTx + 30) {
          translateX.value = withSpring(Math.sign(translateX.value) * maxTx);
        }
        if (Math.abs(translateY.value) > maxTy + 30) {
          translateY.value = withSpring(Math.sign(translateY.value) * maxTy);
        }

        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      }
    });

  // 组合手势：双击互斥单击，同时允许缩放与拖拽
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

  // 计算展示尺寸
  const displayWidth = SCREEN_WIDTH;
  const displayHeight = imgSize
    ? isLongImage
      ? Math.round(SCREEN_WIDTH * (imgSize.height / imgSize.width))
      : Math.min(SCREEN_HEIGHT * 0.8, Math.round(SCREEN_WIDTH * (imgSize.height / imgSize.width)))
    : SCREEN_HEIGHT * 0.6;

  // 长图模式：外层包裹垂直 ScrollView，未放大时可流畅上下滚动阅读
  if (isLongImage) {
    return (
      <View style={styles.slideContainer}>
        <ScrollView
          style={styles.longImageScroll}
          contentContainerStyle={styles.longImageScrollContent}
          showsVerticalScrollIndicator={false}
          bounces={true}
          scrollEnabled={true}
        >
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={animatedStyle}>
              <Image
                source={{ uri }}
                style={{
                  width: displayWidth,
                  height: displayHeight,
                }}
                resizeMode="cover"
              />
            </Animated.View>
          </GestureDetector>
        </ScrollView>
      </View>
    );
  }

  // 常规尺寸图片模式：居中自适应
  return (
    <View style={styles.slideContainer}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.normalImageWrapper, animatedStyle]}>
          <Image
            source={{ uri }}
            style={{
              width: displayWidth,
              height: displayHeight,
            }}
            resizeMode="contain"
          />
        </Animated.View>
      </GestureDetector>
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
        {/* 顶部控制栏 */}
        {showControls && (
          <View style={[styles.topBar, { top: topPadding + 10 }]}>
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>
                {currentIndex + 1} / {images.length}
              </Text>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Ionicons name="close" size={24} color="#ffffff" />
            </TouchableOpacity>
          </View>
        )}

        {/* 核心横向多图轮播区 */}
        <FlatList
          ref={flatListRef}
          data={images}
          keyExtractor={(item, idx) => `${item}_${idx}`}
          horizontal
          pagingEnabled
          scrollEnabled={!isAnyZoomed} // 放大状态锁住轮播翻页，专注看局部
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

        {/* 底部操作胶囊栏 */}
        {showControls && (
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
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counterPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  counterText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  normalImageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  longImageScroll: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  longImageScrollContent: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
