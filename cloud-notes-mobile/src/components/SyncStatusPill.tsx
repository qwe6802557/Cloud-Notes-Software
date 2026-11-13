import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/use-theme';
import ConflictResolveModal from './ConflictResolveModal';
import {
  mobileSyncManager,
  ConflictEntry,
  SyncStateSnapshot,
} from '../utils/storage/mobileSyncManager';

const STATUS_CONFIG = {
  synced: {
    text: '已同步',
    dotColor: '#059669',
    icon: 'checkmark-circle-outline' as const,
  },
  pending: {
    text: '待同步',
    dotColor: '#d97706',
    icon: 'cloud-upload-outline' as const,
  },
  syncing: {
    text: '同步中',
    dotColor: '#1890ff',
    icon: 'sync-outline' as const,
  },
  offline: {
    text: '离线保护',
    dotColor: '#64748b',
    icon: 'cloud-offline-outline' as const,
  },
  conflict: {
    text: '待处理冲突',
    dotColor: '#ef4444',
    icon: 'git-compare-outline' as const,
  },
};

export default function SyncStatusPill() {
  const theme = useTheme();
  const [syncState, setSyncState] = useState<SyncStateSnapshot>(() =>
    mobileSyncManager.getSnapshot()
  );
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState<ConflictEntry | null>(null);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    const unsubscribe = mobileSyncManager.subscribe(snapshot => {
      setSyncState(snapshot);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (syncState.status === 'pending' || syncState.status === 'syncing') {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.25, { duration: 750 }),
          withTiming(0.85, { duration: 750 })
        ),
        -1,
        false
      );
      return () => {
        cancelAnimation(pulseScale);
        pulseScale.value = 1;
      };
    }
    cancelAnimation(pulseScale);
    pulseScale.value = 1;
  }, [syncState.status, pulseScale]);

  const pulseAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const currentConfig = STATUS_CONFIG[syncState.status] || STATUS_CONFIG.synced;
  const conflicts = syncState.conflicts || [];
  const hasConflicts = conflicts.length > 0;

  const formatTime = (date: Date | null) => {
    if (!date) return '尚未同步';
    const d = new Date(date);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const handleOpenConflict = (conflict: ConflictEntry) => {
    setModalVisible(false);
    setSelectedConflict(conflict);
  };

  const handlePillPress = () => {
    setModalVisible(true);
  };

  return (
    <>
      <TouchableOpacity
        style={[
          styles.pillContainer,
          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
          syncState.status === 'offline' && styles.pillOffline,
          syncState.status === 'conflict' && styles.pillConflict,
        ]}
        onPress={handlePillPress}
        activeOpacity={0.75}
      >
        <Animated.View
          style={[
            styles.statusDot,
            { backgroundColor: currentConfig.dotColor },
            pulseAnimatedStyle,
          ]}
        />
        <Text
          style={[
            styles.statusText,
            { color: theme.text },
            syncState.status === 'conflict' && styles.textConflict,
          ]}
        >
          {hasConflicts ? `待裁决 (${conflicts.length})` : currentConfig.text}
        </Text>
        {!hasConflicts && syncState.queuedCount > 0 && (
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

          <View style={[styles.sheetContainer, { backgroundColor: theme.card }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: theme.border }]}>
              <View style={styles.sheetHeaderLeft}>
                <Ionicons
                  name="hardware-chip-outline"
                  size={18}
                  color={theme.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.sheetTitle, { color: theme.text }]}>本地优先存储引擎</Text>
              </View>
              <View style={styles.engineBadge}>
                <Text style={styles.engineBadgeText}>Local-First</Text>
              </View>
            </View>

            <View style={styles.sheetBody}>
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>当前网络：</Text>
                <Text style={[styles.infoVal, syncState.isOnline ? styles.valOnline : styles.valOffline]}>
                  {syncState.isOnline ? '在线网络已就绪' : '离线保护模式 (断网队列排队中)'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>排队待传：</Text>
                <Text style={[styles.infoVal, styles.valMono, { color: theme.text }]}>
                  {syncState.queuedCount > 0 ? `${syncState.queuedCount} 条变更待同步` : '无挂起任务'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>最近同步：</Text>
                <Text style={[styles.infoVal, styles.valMono, { color: theme.text }]}>
                  {formatTime(syncState.lastSyncedAt)}
                </Text>
              </View>

              {hasConflicts && (
                <View style={styles.conflictCard}>
                  <View style={styles.conflictHeaderRow}>
                    <Ionicons name="git-compare-outline" size={15} color="#dc2626" />
                    <Text style={styles.conflictTip}>
                      检测到 {conflicts.length} 篇并发冲突，点击展开 Diff 比对裁决
                    </Text>
                  </View>
                  <ScrollView style={styles.conflictList} nestedScrollEnabled>
                    {conflicts.map(item => (
                      <TouchableOpacity
                        key={item.noteId}
                        style={styles.conflictItemBtn}
                        onPress={() => handleOpenConflict(item)}
                        activeOpacity={0.75}
                      >
                        <Text style={styles.conflictTitle} numberOfLines={1}>
                          {item.title || '无标题笔记'}
                        </Text>
                        <View style={styles.conflictResolveBadge}>
                          <Text style={styles.conflictResolveText}>比对裁决</Text>
                          <Ionicons name="chevron-forward" size={12} color="#dc2626" />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.sheetFooter}>
              {hasConflicts ? (
                <TouchableOpacity
                  style={styles.conflictActionBtn}
                  onPress={() => handleOpenConflict(conflicts[0])}
                  activeOpacity={0.85}
                >
                  <Ionicons name="git-compare-outline" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.actionBtnText}>立即比对裁决</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => {
                    void mobileSyncManager.retryManual();
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
              )}

              <TouchableOpacity
                style={[styles.closeBtn, { backgroundColor: theme.backgroundElement }]}
                onPress={() => setModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={[styles.closeBtnText, { color: theme.textSecondary }]}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConflictResolveModal
        visible={Boolean(selectedConflict)}
        conflict={selectedConflict}
        onClose={() => setSelectedConflict(null)}
        onResolved={() => setSelectedConflict(null)}
      />
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
    borderWidth: 1,
    marginRight: 6,
  },
  pillOffline: {
    opacity: 0.9,
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
  },
  textConflict: {
    color: '#dc2626',
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  engineBadge: {
    backgroundColor: '#e6f4ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  engineBadgeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: '#1890ff',
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
  },
  infoVal: {
    fontSize: 12,
    fontWeight: '500',
  },
  valOnline: {
    color: '#059669',
  },
  valOffline: {
    color: '#64748b',
  },
  valMono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  conflictCard: {
    marginTop: 6,
    padding: 10,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    borderRadius: 10,
    gap: 8,
  },
  conflictHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conflictTip: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  conflictList: {
    maxHeight: 132,
  },
  conflictItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
    borderRadius: 7,
    marginBottom: 4,
    gap: 8,
  },
  conflictTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#1e293b',
  },
  conflictResolveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  conflictResolveText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#1890ff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictActionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#dc2626',
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
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
