import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as authApi from '../api/authApi';
import * as cryptoVault from '../utils/cryptoVault';

interface VaultUnlockModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function VaultUnlockModal({
  visible,
  onClose,
  onSuccess,
}: VaultUnlockModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [hint, setHint] = useState('');
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultSalt, setVaultSalt] = useState('');
  const [vaultHint, setVaultHint] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 检查安全箱状态
  useEffect(() => {
    if (!visible) {
      setPin('');
      setConfirmPin('');
      setErrorMessage('');
      return;
    }

    const checkVault = async () => {
      try {
        setIsLoading(true);
        setErrorMessage('');
        const res = await authApi.getVaultStatus();
        if (res.code === 200 && res.data) {
          setVaultConfigured(Boolean(res.data.enabled));
          setVaultSalt(res.data.salt || '');
          setVaultHint(res.data.hint || '');
        }
      } catch (err: any) {
        setErrorMessage(err.message || '获取安全箱状态失败');
      } finally {
        setIsLoading(false);
      }
    };

    checkVault();
  }, [visible]);

  // 解锁现有安全箱
  const handleUnlock = async () => {
    if (!pin.trim()) {
      setErrorMessage('请输入安全密码');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      const res = await authApi.verifyVault({ pin: pin.trim() });
      if (res.code === 200) {
        cryptoVault.setSessionKey(pin.trim(), vaultSalt);
        onSuccess();
        onClose();
      } else {
        setErrorMessage(res.message || '密码错误，解锁失败');
      }
    } catch (err: any) {
      setErrorMessage(err.message || '验证失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 初始化设置主密码
  const handleSetup = async () => {
    if (!pin.trim() || pin.length < 4) {
      setErrorMessage('主密码不能少于4位');
      return;
    }
    if (pin !== confirmPin) {
      setErrorMessage('两次输入的密码不一致');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage('');
      const res = await authApi.setupVault({ pin: pin.trim(), hint: hint.trim() });
      if (res.code === 200 && res.data) {
        cryptoVault.setSessionKey(pin.trim(), res.data.salt);
        onSuccess();
        onClose();
      } else {
        setErrorMessage(res.message || '安全箱初始化失败');
      }
    } catch (err: any) {
      setErrorMessage(err.message || '设置失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* 顶部图标与徽章 */}
          <View style={styles.badgeContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="lock-closed" size={24} color="#d97706" />
            </View>
            <Text style={styles.title}>
              {vaultConfigured ? '私密笔记保险箱' : '初始化私密安全箱'}
            </Text>
            <Text style={styles.subtitle}>
              {vaultConfigured
                ? '端到端零知识加密保护，输入主密码解锁此会话'
                : '请设置专属端到端加密主密码（服务端仅存散列指纹）'}
            </Text>
          </View>

          {isLoading ? (
            <ActivityIndicator size="small" color="#d97706" style={styles.loader} />
          ) : (
            <View style={styles.form}>
              <TextInput
                style={styles.pinInput}
                placeholder={vaultConfigured ? '输入主密码' : '设置主密码（至少4位）'}
                placeholderTextColor="#71717a"
                value={pin}
                onChangeText={t => {
                  setPin(t);
                  setErrorMessage('');
                }}
                secureTextEntry
                keyboardType="numeric"
                autoFocus
              />

              {!vaultConfigured && (
                <>
                  <TextInput
                    style={styles.pinInput}
                    placeholder="再次确认主密码"
                    placeholderTextColor="#71717a"
                    value={confirmPin}
                    onChangeText={t => {
                      setConfirmPin(t);
                      setErrorMessage('');
                    }}
                    secureTextEntry
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={styles.hintInput}
                    placeholder="密码提示信息 (可选)"
                    placeholderTextColor="#71717a"
                    value={hint}
                    onChangeText={setHint}
                  />
                </>
              )}

              {vaultConfigured && vaultHint ? (
                <Text style={styles.hintText}>提示：{vaultHint}</Text>
              ) : null}

              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

              <View style={styles.actions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={onClose}
                  disabled={isSubmitting}
                >
                  <Text style={styles.cancelBtnText}>取消</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                  onPress={vaultConfigured ? handleUnlock : handleSetup}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.submitBtnText}>
                      {vaultConfigured ? '验证并解锁' : '完成启用'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 9, 11, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#27272a',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  badgeContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(217, 119, 6, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f4f4f5',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    color: '#a1a1aa',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  loader: {
    marginVertical: 24,
  },
  form: {
    width: '100%',
    gap: 12,
  },
  pinInput: {
    height: 46,
    backgroundColor: '#09090b',
    borderRadius: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#f4f4f5',
    fontSize: 16,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    letterSpacing: 4,
    textAlign: 'center',
  },
  hintInput: {
    height: 40,
    backgroundColor: '#09090b',
    borderRadius: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#27272a',
    color: '#d4d4d8',
    fontSize: 13,
  },
  hintText: {
    fontSize: 12,
    color: '#71717a',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#27272a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a1a1aa',
  },
  submitBtn: {
    flex: 1.5,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#d97706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
