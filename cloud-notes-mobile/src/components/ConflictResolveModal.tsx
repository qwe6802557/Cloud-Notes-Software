import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DiffViewer from './DiffViewer';
import VaultUnlockModal from './VaultUnlockModal';
import { useTheme } from '../hooks/use-theme';
import * as cryptoVault from '../utils/cryptoVault';
import {
  mobileSyncManager,
  ConflictEntry,
  ConflictStrategy,
} from '../utils/storage/mobileSyncManager';

export interface ConflictResolveModalProps {
  visible: boolean;
  conflict: ConflictEntry | null;
  onClose: () => void;
  onResolved?: (
    strategy: ConflictStrategy,
    result?: { forkedNote?: any; resolvedNote?: any }
  ) => void;
}

function formatConflictTime(iso?: string): string {
  if (!iso) return '未知时间';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ConflictResolveModal({
  visible,
  conflict,
  onClose,
  onResolved,
}: ConflictResolveModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [diffLayout, setDiffLayout] = useState<'unified' | 'split'>('unified');
  const [localText, setLocalText] = useState('');
  const [serverText, setServerText] = useState('');
  const [decrypting, setDecrypting] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [unlockVisible, setUnlockVisible] = useState(false);
  const [vaultRefreshTick, setVaultRefreshTick] = useState(0);
  const [resolvingStrategy, setResolvingStrategy] = useState<ConflictStrategy | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!visible || !conflict) return;

    let cancelled = false;

    const prepareContent = async () => {
      setErrorMsg('');
      const localEncrypted = Boolean(conflict.localDraft?.isEncrypted);
      const serverEncrypted = Boolean(conflict.serverNote?.isEncrypted);
      const requiresVault = localEncrypted || serverEncrypted;

      if (requiresVault && !cryptoVault.hasSessionKey()) {
        if (!cancelled) {
          setNeedsUnlock(true);
          setDecrypting(false);
          setLocalText('');
          setServerText('');
        }
        return;
      }

      if (!cancelled) {
        setNeedsUnlock(false);
        setDecrypting(requiresVault);
      }

      const pin = cryptoVault.getSessionKey();
      let resolvedLocal = conflict.localDraft?.content || '';
      let resolvedServer = conflict.serverNote?.content || '';

      try {
        if (localEncrypted && conflict.localDraft?.encryptedData && pin) {
          resolvedLocal = await cryptoVault.decryptNote(conflict.localDraft.encryptedData, pin);
        }
        if (serverEncrypted && conflict.serverNote?.encryptedData && pin) {
          resolvedServer = await cryptoVault.decryptNote(conflict.serverNote.encryptedData, pin);
        } else if (serverEncrypted && !conflict.serverNote?.encryptedData) {
          resolvedServer = '';
        }
      } catch {
        if (!cancelled) {
          setErrorMsg('私密密文解封失败，请核对加密保险箱口令或选择强制保留本地草稿');
        }
      } finally {
        if (!cancelled) {
          setLocalText(resolvedLocal);
          setServerText(resolvedServer);
          setDecrypting(false);
        }
      }
    };

    void prepareContent();

    return () => {
      cancelled = true;
    };
  }, [visible, conflict, vaultRefreshTick]);

  const handleResolve = async (strategy: ConflictStrategy) => {
    if (!conflict || resolvingStrategy) return;

    setResolvingStrategy(strategy);
    setErrorMsg('');

    try {
      const res = await mobileSyncManager.resolveConflict(conflict.noteId, strategy);
      if (!res.success) {
        const msg =
          typeof res.error === 'string'
            ? res.error
            : res.error?.message || '处理冲突失败，请检查网络连接后重试';
        setErrorMsg(msg);
        return;
      }

      onResolved?.(strategy, {
        forkedNote: res.forkedNote,
        resolvedNote: res.resolvedNote,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || '处理冲突失败，请重试');
    } finally {
      setResolvingStrategy(null);
    }
  };

  const localTitle = conflict?.localDraft?.title || conflict?.title || '无标题笔记';
  const serverTitle = conflict?.serverNote?.title || conflict?.title || '无标题笔记';
  const hasTitleDiff = Boolean(conflict && localTitle !== serverTitle);
  const serverVersion = conflict?.serverNote?.contentVersion;

  return (
    <Modal
      visible={visible && Boolean(conflict)}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.background,
            paddingTop: Platform.OS === 'android' ? Math.max(insets.top, 12) : 12,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* 顶部栏：冲突说明与关闭 */}
        <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.card }]}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitleGroup}>
              <Ionicons name="git-compare-outline" size={20} color="#dc2626" />
              <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
                版本冲突比对与裁决
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: theme.backgroundElement }]}
              onPress={onClose}
              disabled={Boolean(resolvingStrategy)}
              hitSlop={8}
            >
              <Ionicons name="close" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.metaRow}>
            <Text style={[styles.noteTitleText, { color: theme.text }]} numberOfLines={1}>
              {localTitle}
            </Text>
            <View style={[styles.versionChip, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.versionChipText, { color: theme.textSecondary }]}>
                {typeof serverVersion === 'number' ? `云端 v${serverVersion}` : '云端已变更'} ·{' '}
                {formatConflictTime(conflict?.serverNote?.updatedAt)}
              </Text>
            </View>
          </View>

          {hasTitleDiff && (
            <View style={[styles.titleDiffBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <Text style={[styles.titleDiffLabel, { color: theme.textSecondary }]} numberOfLines={1}>
                云端标题：{serverTitle}
              </Text>
              <Text style={[styles.titleDiffLabel, { color: theme.primary }]} numberOfLines={1}>
                本地标题：{localTitle}
              </Text>
            </View>
          )}

          {/* 对比模式切换 */}
          <View style={styles.modeSwitchRow}>
            <View style={[styles.segmentControl, { backgroundColor: theme.backgroundElement }]}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  diffLayout === 'unified' && { backgroundColor: theme.card },
                ]}
                onPress={() => setDiffLayout('unified')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: diffLayout === 'unified' ? theme.primary : theme.textSecondary },
                  ]}
                >
                  逐行合并对比
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  diffLayout === 'split' && { backgroundColor: theme.card },
                ]}
                onPress={() => setDiffLayout('split')}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: diffLayout === 'split' ? theme.primary : theme.textSecondary },
                  ]}
                >
                  左右双栏对比
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 中部内容区：未解锁保险箱提示 或 DiffViewer */}
        <View style={styles.diffArea}>
          {needsUnlock ? (
            <View style={[styles.lockGateCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Ionicons name="lock-closed-outline" size={32} color={theme.primary} />
              <Text style={[styles.lockGateTitle, { color: theme.text }]}>
                私密加密笔记需要解封后查看差异
              </Text>
              <Text style={[styles.lockGateDesc, { color: theme.textSecondary }]}>
                为保护端到端加密安全，本地未明文缓存正文字段。解锁保险箱后即可在内存中解密并比对本地与云端差异。
              </Text>
              <TouchableOpacity
                style={[styles.unlockBtn, { backgroundColor: theme.primary }]}
                onPress={() => setUnlockVisible(true)}
                activeOpacity={0.85}
              >
                <Ionicons name="key-outline" size={18} color="#ffffff" />
                <Text style={styles.unlockBtnText}>解锁加密保险箱</Text>
              </TouchableOpacity>
            </View>
          ) : decrypting ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                正在内存中解封密文并计算差异...
              </Text>
            </View>
          ) : (
            <DiffViewer
              oldValue={serverText}
              newValue={localText}
              oldTitle="云端当前版本"
              newTitle="本地待同步草稿"
              layout={diffLayout}
            />
          )}
        </View>

        {Boolean(errorMsg) && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={16} color="#dc2626" />
            <Text style={styles.errorBannerText}>{errorMsg}</Text>
          </View>
        )}

        {/* 底部三策略触控裁决按钮组（均 >= 48px） */}
        <View style={[styles.footer, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
          <TouchableOpacity
            style={[
              styles.primaryDecisionBtn,
              { backgroundColor: theme.primary },
              Boolean(resolvingStrategy) && styles.disabledBtn,
            ]}
            onPress={() => void handleResolve('keep_local')}
            disabled={Boolean(resolvingStrategy)}
            activeOpacity={0.85}
          >
            {resolvingStrategy === 'keep_local' ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Ionicons name="cloud-upload-outline" size={18} color="#ffffff" />
            )}
            <Text style={styles.primaryDecisionText}>保留本地覆盖</Text>
          </TouchableOpacity>

          <View style={styles.secondaryRow}>
            <TouchableOpacity
              style={[
                styles.secondaryDecisionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                Boolean(resolvingStrategy) && styles.disabledBtn,
              ]}
              onPress={() => void handleResolve('use_server')}
              disabled={Boolean(resolvingStrategy)}
              activeOpacity={0.8}
            >
              {resolvingStrategy === 'use_server' ? (
                <ActivityIndicator size="small" color={theme.text} />
              ) : (
                <Ionicons name="cloud-download-outline" size={17} color={theme.text} />
              )}
              <Text style={[styles.secondaryDecisionText, { color: theme.text }]}>
                采用云端版本
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.secondaryDecisionBtn,
                { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                Boolean(resolvingStrategy) && styles.disabledBtn,
              ]}
              onPress={() => void handleResolve('fork_copy')}
              disabled={Boolean(resolvingStrategy)}
              activeOpacity={0.8}
            >
              {resolvingStrategy === 'fork_copy' ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <Ionicons name="copy-outline" size={17} color={theme.primary} />
              )}
              <Text style={[styles.secondaryDecisionText, { color: theme.primary }]}>
                另存冲突副本
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <VaultUnlockModal
        visible={unlockVisible}
        onClose={() => setUnlockVisible(false)}
        onSuccess={() => {
          setUnlockVisible(false);
          setVaultRefreshTick(v => v + 1);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteTitleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  versionChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  versionChipText: {
    fontSize: 11,
    fontWeight: '500',
  },
  titleDiffBar: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  titleDiffLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  modeSwitchRow: {
    marginTop: 2,
  },
  segmentControl: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
  },
  segmentBtn: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  diffArea: {
    flex: 1,
    padding: 12,
  },
  lockGateCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  lockGateTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  lockGateDesc: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 300,
  },
  unlockBtn: {
    marginTop: 8,
    height: 48,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  unlockBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fee2e2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#b91c1c',
    fontWeight: '500',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  primaryDecisionBtn: {
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryDecisionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryDecisionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secondaryDecisionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  disabledBtn: {
    opacity: 0.55,
  },
});
