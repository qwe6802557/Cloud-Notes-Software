import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as stashApi from '../../api/stashApi';
import { StashFile } from '../../api/stashApi';

const formatBytes = (bytes: number, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatCountdown = (totalSeconds: number | null) => {
  if (!totalSeconds || totalSeconds <= 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const getFileIcon = (filename: string = '', mimetype: string = '') => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) || mimetype.startsWith('image/')) {
    return { name: 'image-outline' as const, color: '#2563eb', bg: '#eff6ff' };
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md'].includes(ext) || mimetype.includes('pdf') || mimetype.includes('document')) {
    return { name: 'document-text-outline' as const, color: '#ea580c', bg: '#fff7ed' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mimetype.includes('zip') || mimetype.includes('compressed')) {
    return { name: 'archive-outline' as const, color: '#9333ea', bg: '#faf5ff' };
  }
  if (['mp4', 'mov', 'avi', 'mp3', 'wav'].includes(ext) || mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
    return { name: 'videocam-outline' as const, color: '#dc2626', bg: '#fef2f2' };
  }
  if (['js', 'ts', 'tsx', 'py', 'json', 'html', 'css'].includes(ext)) {
    return { name: 'code-slash-outline' as const, color: '#16a34a', bg: '#f0fdf4' };
  }
  return { name: 'document-outline' as const, color: '#64748b', bg: '#f1f5f9' };
};

export default function StashScreen() {
  const [currentTab, setCurrentTab] = useState<'temp' | 'permanent'>('temp');
  const [files, setFiles] = useState<StashFile[]>([]);
  const [tempCount, setTempCount] = useState(0);
  const [permanentCount, setPermanentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showPickerSheet, setShowPickerSheet] = useState(false);

  // 拉取暂存文件列表
  const loadFiles = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const res = await stashApi.getStashFiles(currentTab);
      if (res.code === 200 && res.data) {
        setFiles(res.data.files || []);
        setTempCount(res.data.tempCount ?? 0);
        setPermanentCount(res.data.permanentCount ?? 0);
      }
    } catch (e: any) {
      console.warn('Fetch stash files failed:', e.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentTab]);

  useFocusEffect(
    useCallback(() => {
      loadFiles();
    }, [loadFiles])
  );

  // 10 分钟倒计时秒级递减驱动
  useEffect(() => {
    if (currentTab !== 'temp') return;

    const interval = setInterval(() => {
      setFiles(prev => {
        let hasExpired = false;
        const next = prev
          .map(f => {
            if (f.storageType !== 'temp') return f;
            const nextSec = (f.remainingSeconds ?? 0) - 1;
            if (nextSec <= 0) {
              hasExpired = true;
              return null;
            }
            return { ...f, remainingSeconds: nextSec };
          })
          .filter(Boolean) as StashFile[];

        if (hasExpired) {
          setTempCount(next.length);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentTab]);

  // 从相册选取
  const handlePickFromLibrary = async () => {
    setShowPickerSheet(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const MAX_SIZE = 100 * 1024 * 1024;
        if (asset.fileSize && asset.fileSize > MAX_SIZE) {
          Alert.alert('上传失败', '文件超过 100MB 限制');
          return;
        }

        setIsUploading(true);
        await stashApi.uploadStashFile(
          {
            uri: asset.uri,
            name: asset.fileName || `mobile_stash_${Date.now()}.jpg`,
            type: asset.mimeType || 'image/jpeg',
            file: (asset as any).file,
          },
          currentTab
        );
        Alert.alert('提示', currentTab === 'temp' ? '临时文件已暂存（10分钟后自动销毁）' : '文件已永久保存');
        loadFiles(true);
      }
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '网络异常，请重试');
    } finally {
      setIsUploading(false);
    }
  };

  // 从手机系统文件选取
  const handlePickFromDocuments = async () => {
    setShowPickerSheet(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const MAX_SIZE = 100 * 1024 * 1024;
        if (asset.size && asset.size > MAX_SIZE) {
          Alert.alert('上传失败', '文件超过 100MB 限制');
          return;
        }

        setIsUploading(true);
        await stashApi.uploadStashFile(
          {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType || 'application/octet-stream',
            file: (asset as any).file,
          },
          currentTab
        );
        Alert.alert('提示', currentTab === 'temp' ? '临时文件已暂存（10分钟后自动销毁）' : '文件已永久保存');
        loadFiles(true);
      }
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '选择或上传文件失败');
    } finally {
      setIsUploading(false);
    }
  };

  // 复制直链
  const handleCopyUrl = async (file: StashFile) => {
    if (!file.url) return;
    try {
      await Clipboard.setStringAsync(file.url);
      Alert.alert('复制成功', '文件直链已存入剪贴板，可粘贴发送或在浏览器中打开');
    } catch {
      Alert.alert('文件直链', file.url);
    }
  };

  // 下载或直接打开
  const handleOpenUrl = (file: StashFile) => {
    if (file.url) {
      Linking.openURL(file.url).catch(() => {
        Alert.alert('打开失败', '无法打开此文件链接');
      });
    }
  };

  // 临时转永久
  const handlePromote = async (file: StashFile) => {
    try {
      await stashApi.promoteStashFile(file._id || file.id || '');
      Alert.alert('成功', `【${file.originalName}】已升级为永久文件`);
      loadFiles(true);
    } catch (e: any) {
      Alert.alert('操作失败', e.message || '转为永久保存失败');
    }
  };

  // 删除文件
  const handleDelete = (file: StashFile) => {
    Alert.alert(
      '确认删除',
      `确定要彻底删除文件【${file.originalName}】吗？`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '彻底删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await stashApi.deleteStashFile(file._id || file.id || '');
              loadFiles(true);
            } catch (e: any) {
              Alert.alert('删除失败', e.message || '网络异常');
            }
          },
        },
      ]
    );
  };

  const renderFileCard = ({ item }: { item: StashFile }) => {
    const meta = getFileIcon(item.originalName, item.mimetype);
    const isTemp = item.storageType === 'temp';
    const remaining = item.remainingSeconds ?? 0;
    const isUrgent = isTemp && remaining <= 60;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.name} size={22} color={meta.color} />
          </View>
          <View style={styles.cardMetaCol}>
            <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="middle">
              {item.originalName}
            </Text>
            <View style={styles.cardSubRow}>
              <Text style={styles.cardSize}>{formatBytes(item.size)}</Text>
              {isTemp ? (
                <View style={[styles.badgePill, isUrgent && styles.badgeUrgent]}>
                  <View style={[styles.badgeDot, isUrgent && styles.badgeDotUrgent]} />
                  <Text style={[styles.badgeText, isUrgent && styles.badgeTextUrgent]}>
                    剩余 {formatCountdown(remaining)}
                  </Text>
                </View>
              ) : (
                <View style={styles.permanentPill}>
                  <Text style={styles.permanentText}>永久保存</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* 底部操作行 */}
        <View style={styles.cardActionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleOpenUrl(item)}>
            <Ionicons name="download-outline" size={15} color="#2563eb" />
            <Text style={[styles.actionBtnText, { color: '#2563eb' }]}>打开/下载</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => handleCopyUrl(item)}>
            <Ionicons name="copy-outline" size={15} color="#475569" />
            <Text style={styles.actionBtnText}>复制直链</Text>
          </TouchableOpacity>

          {isTemp && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handlePromote(item)}>
              <Ionicons name="bookmark-outline" size={15} color="#d97706" />
              <Text style={[styles.actionBtnText, { color: '#d97706' }]}>转永久</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={[styles.actionBtn, styles.deleteBtn]} onPress={() => handleDelete(item)}>
            <Ionicons name="trash-outline" size={15} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 顶部双分区切换 */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, currentTab === 'temp' && styles.segmentBtnActive]}
          onPress={() => setCurrentTab('temp')}
        >
          <Text style={[styles.segmentText, currentTab === 'temp' && styles.segmentTextActive]}>
            临时文件 (10分钟)
          </Text>
          <View style={[styles.countBadge, currentTab === 'temp' && styles.countBadgeActive]}>
            <Text style={[styles.countText, currentTab === 'temp' && styles.countTextActive]}>
              {tempCount}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, currentTab === 'permanent' && styles.segmentBtnActive]}
          onPress={() => setCurrentTab('permanent')}
        >
          <Text style={[styles.segmentText, currentTab === 'permanent' && styles.segmentTextActive]}>
            永久文件
          </Text>
          <View style={[styles.countBadge, currentTab === 'permanent' && styles.countBadgeActive]}>
            <Text style={[styles.countText, currentTab === 'permanent' && styles.countTextActive]}>
              {permanentCount}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 规则说明条 */}
      <View style={styles.hintBar}>
        <Ionicons
          name={currentTab === 'temp' ? 'time-outline' : 'cloud-done-outline'}
          size={14}
          color="#64748b"
        />
        <Text style={styles.hintText}>
          {currentTab === 'temp'
            ? '临时文件在上传 10 分钟后自动彻底销毁，支持转为永久'
            : '永久文件安全存储，支持跨端无限制下载与查看'}
        </Text>
      </View>

      {/* 文件列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
          <Text style={styles.loadingText}>加载暂存文件中...</Text>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={item => item._id || item.id || ''}
          renderItem={renderFileCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadFiles(true)}
              tintColor="#1890ff"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cloud-upload-outline" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>暂无{currentTab === 'temp' ? '临时' : '永久'}文件</Text>
              <Text style={styles.emptySubtitle}>
                点击下方「上传文件」按钮，选择手机相册或系统文件快速暂存互传
              </Text>
            </View>
          }
        />
      )}

      {/* 底部悬浮上传按钮 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.uploadFab}
          onPress={() => setShowPickerSheet(true)}
          disabled={isUploading}
        >
          {isUploading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="cloud-upload" size={18} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.uploadFabText}>
                上传至【{currentTab === 'temp' ? '临时暂存' : '永久文件'}】
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* 双通道选择弹窗 */}
      <Modal
        visible={showPickerSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPickerSheet(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPickerSheet(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>选择暂存文件来源 (单文件最高100MB)</Text>

            <TouchableOpacity style={styles.sheetOption} onPress={handlePickFromLibrary}>
              <View style={[styles.sheetIconBox, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="images-outline" size={22} color="#2563eb" />
              </View>
              <View style={styles.sheetOptionTextCol}>
                <Text style={styles.sheetOptionPrimary}>从手机相册选取</Text>
                <Text style={styles.sheetOptionSecondary}>支持图片、动图与高清视频</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOption} onPress={handlePickFromDocuments}>
              <View style={[styles.sheetIconBox, { backgroundColor: '#f0fdf4' }]}>
                <Ionicons name="folder-open-outline" size={22} color="#16a34a" />
              </View>
              <View style={styles.sheetOptionTextCol}>
                <Text style={styles.sheetOptionPrimary}>从手机文件管理器选取</Text>
                <Text style={styles.sheetOptionSecondary}>支持 PDF、Word、Excel、压缩包等任意文件</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetCancelBtn}
              onPress={() => setShowPickerSheet(false)}
            >
              <Text style={styles.sheetCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  countBadge: {
    backgroundColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countBadgeActive: {
    backgroundColor: '#eff6ff',
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  countTextActive: {
    color: '#2563eb',
  },
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  hintText: {
    fontSize: 12,
    color: '#64748b',
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMetaCol: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 4,
  },
  cardSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardSize: {
    fontSize: 12,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 4,
  },
  badgeUrgent: {
    backgroundColor: '#fee2e2',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#d97706',
  },
  badgeDotUrgent: {
    backgroundColor: '#dc2626',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#b45309',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  badgeTextUrgent: {
    color: '#dc2626',
  },
  permanentPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  permanentText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#059669',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginTop: 12,
    paddingTop: 10,
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
  },
  deleteBtn: {
    marginLeft: 'auto',
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748b',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  uploadFab: {
    backgroundColor: '#1890ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 10,
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  uploadFabText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
    textAlign: 'center',
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  sheetIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOptionTextCol: {
    flex: 1,
  },
  sheetOptionPrimary: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  sheetOptionSecondary: {
    fontSize: 12,
    color: '#94a3b8',
  },
  sheetCancelBtn: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
  },
  sheetCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
});
