import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import mobileSyncManager, { SyncStateSnapshot } from '../utils/storage/mobileSyncManager';

const STATUS_CONFIG = {
  synced: {
    text: '已同步',
    dotColor: '#059669',
    icon: 'checkmark-circle-outline' as const,
    title: '所有更改已实时同步至云端',
  },
  pending: {
    text: '待同步',
    dotColor: '#d97706',
    icon: 'cloud-upload-outline' as const,
    title: '内容已牢固保存在本地 AsyncStorage，等待上传',
  },
  syncing: {
    text: '同步中',
    dotColor: '#2563eb',
    icon: 'sync-outline' as const,
    title: '正在增量推送到云端服务',
  },
  offline: {
    text: '离线保护',
    dotColor: '#71717a',
    icon: 'cloud-offline-outline' as const,
    title: '网络未连接，已转入本地离线突变队列安全保护',
  },
  conflict: {
    text: '冲突已分叉',
    dotColor: '#e11d48',
    icon: 'alert-circle-outline' as const,
    title: '检测到云端存在并发修改，已自动安全分叉另存为副本',
  },
};

export default function SyncStatusPill() {
  const [syncState, setSyncState] = useState<SyncStateSnapshot>(() => mobileSyncManager.getSnapshot());
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = mobileSyncManager.subscribe(snapshot => {
      setSyncState(snapshot);
    });
    return unsubscribe;
  }, []);

  const currentConfig = STATUS_CONFIG[syncState.status] || STATUS_CONFIG.synced;

  const formatTime = (date: Date | null) => {
    if (!date) return '尚未同步';
    const d = new Date(date);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.pillContainer,
          syncState.status === 'offline' && styles.pillOffline,
          syncState.status === 'conflict' && styles.pillConflict,
        ]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.7}
      >
        <View style={[styles.statusDot, { backgroundColor: currentConfig.dotColor }]} />
        <Text style={[styles.statusText, syncState.status === 'conflict' && styles.textConflict]}>
          {currentConfig.text}
        </Text>
        {syncState.queuedCount > 0 && (
          <View style={styles.badgeCount}>
            <Text style={styles.badgeText}>{syncState.queuedCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* 状态详情半屏弹窗 */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderLeft}>
                <Ionicons name="hardware-chip-outline" size={18} color="#2563eb" style={{ marginRight: 6 }} />
                <Text style={styles.sheetTitle}>本地优先存储引擎</Text>
              </View>
              <View style={styles.engineBadge}>
                <Text style={styles.engineBadgeText}>AsyncStorage</Text>
              </View>
            </View>

            <View style={styles.sheetBody}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>当前网络：</Text>
                <Text style={[styles.infoVal, syncState.isOnline ? styles.valOnline : styles.valOffline]}>
                  {syncState.isOnline ? '在线网络已就绪' : '离线保护模式 (断网自愈中)'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>排队待传：</Text>
                <Text style={[styles.infoVal, styles.valMono]}>
                  {syncState.queuedCount > 0 ? `${syncState.queuedCount} 条突变任务待发` : '无挂起任务'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>最近同步：</Text>
                <Text style={[styles.infoVal, styles.valMono]}>{formatTime(syncState.lastSyncedAt)}</Text>
              </View>

              {Boolean(syncState.lastConflictNote) && (
                <View style={styles.conflictCard}>
                  <Text style={styles.conflictTip}>⚠️ 检测到版本冲突，已自动安全分叉另存：</Text>
                  <Text style={styles.conflictTitle} numberOfLines={1}>
                    {syncState.lastConflictNote?.title || '新副本'}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => {
                  mobileSyncManager.retryManual();
                }}
                disabled={syncState.status === 'syncing'}
                activeOpacity={0.8}
              >
                {syncState.status === 'syncing' ? (
                  <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 6 }} />
                ) : (
                  <Ionicons name="sync-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                )}
                <Text style={styles.actionBtnText}>立即同步</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.closeBtnText}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pillContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 6,
  },
  pillOffline: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  pillConflict: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#334155',
  },
  textConflict: {
    color: '#e11d48',
  },
  badgeCount: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
  },
  badgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: '#d97706',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  sheetContainer: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 12,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  engineBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  engineBadgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: '#2563eb',
  },
  sheetBody: {
    gap: 8,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  infoLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  infoVal: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1e293b',
  },
  valOnline: {
    color: '#059669',
  },
  valOffline: {
    color: '#71717a',
  },
  valMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  conflictCard: {
    marginTop: 6,
    padding: 8,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 8,
  },
  conflictTip: {
    fontSize: 11,
    fontWeight: '600',
    color: '#e11d48',
    marginBottom: 2,
  },
  conflictTitle: {
    fontSize: 11,
    color: '#9f1239',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  closeBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    color: '#475569',
  },
});
