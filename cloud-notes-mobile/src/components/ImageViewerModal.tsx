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

export interface ImageViewerModalProps {
  visible: boolean;
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const flatListRef = useRef<FlatList<string>>(null);

  const topPadding = Math.max(
    insets.top,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0
  );

  useEffect(() => {
    if (visible) {
      const targetIdx = Math.max(0, Math.min(initialIndex, images.length - 1));
      setCurrentIndex(targetIdx);
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: targetIdx, animated: false });
      }, 50);
    }
  }, [visible, initialIndex, images.length]);

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

      // 移动端下载至本地缓存目录
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
    ({ item }: { item: string }) => {
      return (
        <View style={styles.imageSlide}>
          <ScrollView
            style={styles.zoomScroll}
            contentContainerStyle={styles.zoomScrollContent}
            maximumZoomScale={3}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            <Image
              source={{ uri: item }}
              style={styles.fullImage}
              resizeMode="contain"
            />
          </ScrollView>
        </View>
      );
    },
    []
  );

  if (!visible || images.length === 0) return null;

  return (
    <Modal visible={visible} transparent={false} animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" translucent />
      <View style={styles.container}>
        {/* 顶部控制栏 */}
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

        {/* 核心横向多图轮播区 */}
        <FlatList
          ref={flatListRef}
          data={images}
          keyExtractor={(item, idx) => `${item}_${idx}`}
          horizontal
          pagingEnabled
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
      </View>
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageSlide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomScroll: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  zoomScrollContent: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
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
