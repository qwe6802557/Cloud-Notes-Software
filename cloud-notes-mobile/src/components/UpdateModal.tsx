import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAppUpdate } from '../context/UpdateContext';

const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export const UpdateModal: React.FC = () => {
  const {
    updateData,
    isModalVisible,
    isDownloading,
    downloadProgress,
    downloadedBytes,
    totalBytes,
    isCompleted,
    startUpdate,
    dismissModal,
    openInstallPermissionSettings,
  } = useAppUpdate();

  if (!isModalVisible || !updateData) {
    return null;
  }

  const isOta = updateData.type === 'ota';
  const sizeText = updateData.size ? ` (${formatBytes(updateData.size)})` : '';

  return (
    <Modal
      visible={isModalVisible}
      transparent
      animationType="fade"
      onRequestClose={dismissModal}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* 顶部标签 */}
          <View style={styles.header}>
            <View style={[styles.badge, isOta ? styles.badgeOta : styles.badgeNative]}>
              <Ionicons
                name={isOta ? 'flash' : 'cube-outline'}
                size={14}
                color={isOta ? '#1890ff' : '#722ed1'}
              />
              <Text style={[styles.badgeText, isOta ? styles.badgeTextOta : styles.badgeTextNative]}>
                {isOta ? '极速热更新 · 无需重装' : '原生版本升级'}
              </Text>
            </View>

            {!updateData.forceUpdate && !isDownloading && (
              <TouchableOpacity
                onPress={dismissModal}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={20} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          {/* 版本与标题 */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{updateData.title || `新版本 v${updateData.version}`}</Text>
            <Text style={styles.versionSub}>
              最新版本: v{updateData.version} (Build {updateData.buildNumber})
            </Text>
          </View>

          {/* 更新日志 */}
          <View style={styles.changelogBox}>
            <Text style={styles.changelogHeader}>更新内容说明：</Text>
            <ScrollView style={styles.changelogScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.changelogText}>
                {updateData.changelog || '· 性能提升与稳定性优化\n· 界面细节打磨'}
              </Text>
            </ScrollView>
          </View>

          {/* 下载进度状态条 */}
          {isDownloading ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.max(5, Math.min(100, downloadProgress))}%` },
                  ]}
                />
              </View>
              <View style={styles.progressTextRow}>
                <Text style={styles.progressPercent}>{downloadProgress}%</Text>
                <Text style={styles.progressSize}>
                  {totalBytes > 0
                    ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                    : isCompleted
                    ? '下载完成，正在生效...'
                    : '正在安全拉取资源...'}
                </Text>
              </View>
            </View>
          ) : null}

          {/* 操作按钮组 */}
          <View style={styles.actions}>
            {isDownloading ? (
              <View style={[styles.btn, styles.btnLoading]}>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.btnText}>
                  {isCompleted ? '正在准备重启应用...' : '正在下载更新资源...'}
                </Text>
              </View>
            ) : (
              <>
                {!updateData.forceUpdate && (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnSecondary]}
                    onPress={dismissModal}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.btnSecondaryText}>稍后提醒</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, updateData.forceUpdate && { flex: 1 }]}
                  onPress={startUpdate}
                  activeOpacity={0.8}
                >
                  <Ionicons name="arrow-down-circle-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>立即更新{sizeText}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* 辅助通道（未知来源权限开启与浏览器直链下载） */}
          {!isDownloading && Boolean(updateData.apkUrl || updateData.downloadUrl) && (
            <View style={styles.troubleShootContainer}>
              <TouchableOpacity
                style={styles.troubleShootRow}
                onPress={openInstallPermissionSettings}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark-outline" size={13} color="#64748b" />
                <Text style={styles.troubleShootText}>提示未授权？点此开启应用安装权限</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.troubleShootRow}
                onPress={() => {
                  const target = updateData.apkUrl || updateData.downloadUrl;
                  if (target) Linking.openURL(target);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="globe-outline" size={13} color="#64748b" />
                <Text style={styles.troubleShootText}>权限受阻？点此在浏览器中直接下载安装</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 22,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeOta: {
    backgroundColor: '#e6f7ff',
    borderColor: '#91d5ff',
  },
  badgeNative: {
    backgroundColor: '#f9f0ff',
    borderColor: '#d3adf7',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  badgeTextOta: {
    color: '#1890ff',
  },
  badgeTextNative: {
    color: '#722ed1',
  },
  titleSection: {
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  versionSub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  changelogBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 16,
  },
  changelogHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  changelogScroll: {
    maxHeight: 140,
  },
  changelogText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#475569',
  },
  progressContainer: {
    marginBottom: 16,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#1890ff',
    borderRadius: 4,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1890ff',
    fontVariant: ['tabular-nums'],
  },
  progressSize: {
    fontSize: 12,
    color: '#64748b',
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: '#1890ff',
  },
  btnSecondary: {
    backgroundColor: '#f1f5f9',
  },
  btnLoading: {
    backgroundColor: '#1890ff',
    opacity: 0.9,
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  btnSecondaryText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#475569',
  },
  troubleShootContainer: {
    marginTop: 14,
    gap: 8,
  },
  troubleShootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  troubleShootText: {
    fontSize: 12,
    color: '#64748b',
    textDecorationLine: 'underline',
  },
});
