import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/authApi';
import { CaptchaData } from '../api/types';
import { Colors } from '../constants/theme';
import { Config } from '../constants/Config';

export default function LoginScreen() {
  const router = useRouter();
  const { login, serverUrl, updateServerUrl } = useAuth();

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaData, setCaptchaData] = useState<CaptchaData | null>(null);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 服务器配置弹窗
  const [showServerModal, setShowServerModal] = useState(false);
  const [tempServerUrl, setTempServerUrl] = useState(serverUrl);

  const fetchCaptcha = async () => {
    try {
      setIsLoadingCaptcha(true);
      const res = await authApi.getCaptcha();
      if (res.code === 200 && res.data) {
        setCaptchaData(res.data);
      }
    } catch (e: any) {
      console.warn('Captcha fetch failed:', e.message);
    } finally {
      setIsLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    fetchCaptcha();
  }, [serverUrl]);

  const handleLogin = async () => {
    if (!account.trim()) {
      Alert.alert('提示', '请输入账号或邮箱');
      return;
    }
    if (!password.trim()) {
      Alert.alert('提示', '请输入密码');
      return;
    }
    if (!captchaCode.trim()) {
      Alert.alert('提示', '请输入图形验证码');
      return;
    }

    try {
      setIsSubmitting(true);
      await login(account.trim(), password, captchaCode.trim(), captchaData?.captchaKey);
      router.replace('/(tabs)');
    } catch (error: any) {
      Alert.alert('登录失败', error.message || '请核对账号、密码及验证码');
      fetchCaptcha(); // 刷新验证码
      setCaptchaCode('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveServer = async () => {
    if (!tempServerUrl.trim()) return;
    try {
      await updateServerUrl(tempServerUrl.trim());
      setShowServerModal(false);
      Alert.alert('提示', '服务器地址已更新');
    } catch (e: any) {
      Alert.alert('错误', '更新服务器地址失败');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Logo 区域 */}
          <View style={styles.header}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoText}>囧</Text>
            </View>
            <Text style={styles.title}>囧人云笔记</Text>
            <Text style={styles.subtitle}>极简高效的云笔记平台</Text>
          </View>

          {/* 表单卡片 */}
          <View style={styles.card}>
            {/* 账号 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>账号 / 邮箱</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="请输入用户名或登录邮箱"
                  placeholderTextColor="#94a3b8"
                  value={account}
                  onChangeText={setAccount}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* 密码 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>密码</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="请输入密码"
                  placeholderTextColor="#94a3b8"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            </View>

            {/* 验证码 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>图形验证码</Text>
              <View style={styles.captchaRow}>
                <View style={[styles.inputWrapper, { flex: 1 }]}>
                  <Ionicons name="shield-checkmark-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="输入右侧字符"
                    placeholderTextColor="#94a3b8"
                    value={captchaCode}
                    onChangeText={setCaptchaCode}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={6}
                  />
                </View>

                {/* 验证码预览（点击刷新） */}
                <TouchableOpacity
                  style={styles.captchaBox}
                  onPress={fetchCaptcha}
                  activeOpacity={0.7}
                >
                  {isLoadingCaptcha ? (
                    <ActivityIndicator size="small" color="#1890ff" />
                  ) : captchaData?.svg ? (
                    <Image
                      source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(captchaData.svg)}` }}
                      style={styles.captchaSvg}
                      contentFit="contain"
                    />
                  ) : (
                    <Text style={styles.captchaTip}>点击重试</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* 登录按钮 */}
            <TouchableOpacity
              style={[styles.loginBtn, isSubmitting && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.loginBtnText}>登 录</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* 底部服务器配置入口 */}
          <View style={styles.serverFooter}>
            <TouchableOpacity
              style={styles.serverRow}
              onPress={() => {
                setTempServerUrl(serverUrl);
                setShowServerModal(true);
              }}
            >
              <Ionicons name="server-outline" size={14} color="#64748b" />
              <Text style={styles.serverText} numberOfLines={1}>
                服务节点：{serverUrl}
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 服务器切换弹窗 */}
      <Modal visible={showServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>配置后端服务器地址</Text>
            <Text style={styles.modalDesc}>
              默认连接生产云端服务。如果正在局域网联调，可填入本机 IP (如 http://192.168.1.5:3001)
            </Text>

            <TextInput
              style={styles.modalInput}
              value={tempServerUrl}
              onChangeText={setTempServerUrl}
              placeholder="https://notes.yanggenbwebsite.site"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.presetRow}>
              <TouchableOpacity
                style={styles.presetBtn}
                onPress={() => setTempServerUrl(Config.defaultServerUrl)}
              >
                <Text style={styles.presetBtnText}>填入生产线上地址</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setShowServerModal(false)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirmBtn]}
                onPress={handleSaveServer}
              >
                <Text style={styles.modalConfirmText}>确认切换</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  logoText: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: 'bold',
    includeFontPadding: false,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 6,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
    paddingVertical: 0,
  },
  eyeBtn: {
    padding: 6,
  },
  captchaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  captchaBox: {
    width: 108,
    height: 48,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  captchaSvg: {
    width: '100%',
    height: '100%',
  },
  captchaTextContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  captchaTip: {
    fontSize: 11,
    color: '#1890ff',
    fontWeight: '500',
  },
  loginBtn: {
    backgroundColor: '#1890ff',
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#1890ff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2,
  },
  serverFooter: {
    marginTop: 28,
    alignItems: 'center',
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    maxWidth: '90%',
  },
  serverText: {
    fontSize: 12,
    color: '#64748b',
    marginHorizontal: 6,
    flexShrink: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 12,
  },
  presetRow: {
    marginBottom: 16,
  },
  presetBtn: {
    alignSelf: 'flex-start',
  },
  presetBtnText: {
    fontSize: 12,
    color: '#1890ff',
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalCancelBtn: {
    backgroundColor: '#f1f5f9',
  },
  modalCancelText: {
    fontSize: 14,
    color: '#64748b',
  },
  modalConfirmBtn: {
    backgroundColor: '#1890ff',
  },
  modalConfirmText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
});
