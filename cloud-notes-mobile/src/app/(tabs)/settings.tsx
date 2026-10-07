import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useAppUpdate } from '../../context/UpdateContext';
import { Config } from '../../constants/Config';
import * as aiApi from '../../api/aiApi';
import axios from 'axios';

const SYSTEM_MODELS = [
  {
    id: 'grok-chat-fast',
    name: 'Grok 极速',
    iconName: 'rocket-outline' as const,
    iconColor: '#7c3aed',
    badge: '高速',
  },
  {
    id: 'glm-4-flash',
    name: 'GLM-4-Flash',
    iconName: 'flash-outline' as const,
    iconColor: '#eab308',
    badge: '轻量',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    name: 'DeepSeek-R1',
    iconName: 'bulb-outline' as const,
    iconColor: '#8b5cf6',
    badge: '思考',
  },
  {
    id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    name: 'Qwen-Coder',
    iconName: 'code-slash-outline' as const,
    iconColor: '#0284c7',
    badge: '代码',
  },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { user, serverUrl, updateServerUrl, logout, refreshUser } = useAuth();
  const { currentVersion, currentBuildNumber, isChecking: isCheckingUpdate, hasUpdate, checkForUpdates } = useAppUpdate();

  const [showServerModal, setShowServerModal] = useState(false);
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [isTestingPing, setIsTestingPing] = useState(false);

  // AI 配置相关状态
  const [showAIConfigModal, setShowAIConfigModal] = useState(false);
  const [aiSystemModel, setAiSystemModel] = useState('grok-chat-fast');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [isSavingAI, setIsSavingAI] = useState(false);

  const loadAIConfig = useCallback(async () => {
    try {
      const res = await aiApi.getAIConfig();
      if (res.code === 200 && res.data) {
        setAiApiKey(res.data.apiKey || '');
        setAiBaseUrl(res.data.baseUrl || '');
        setAiModel(res.data.model || '');
        setAiSystemModel(res.data.systemModel || 'grok-chat-fast');
      }
    } catch (e: any) {
      console.warn('Failed to load AI config', e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshUser();
      loadAIConfig();
    }, [refreshUser, loadAIConfig])
  );

  const handleTestAI = async () => {
    try {
      setIsTestingAI(true);
      const res = await aiApi.testAIConnection({
        apiKey: aiApiKey.trim(),
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
      });
      if (res.code === 200) {
        const replyText = res.data?.reply ? `\n回复：${res.data.reply}` : '';
        Alert.alert('连通性测试成功', `AI 服务响应正常！${replyText}`);
      } else {
        Alert.alert('测试异常', res.message || '连接失败');
      }
    } catch (e: any) {
      Alert.alert('测试失败', e.message || '无法连接到 AI 服务');
    } finally {
      setIsTestingAI(false);
    }
  };

  const handleSaveAI = async () => {
    try {
      setIsSavingAI(true);
      await aiApi.updateAIConfig({
        apiKey: aiApiKey.trim(),
        baseUrl: aiBaseUrl.trim(),
        model: aiModel.trim(),
        systemModel: aiSystemModel || 'grok-chat-fast',
      });
      setShowAIConfigModal(false);
      Alert.alert('保存成功', 'AI 模型参数已更新生效');
    } catch (e: any) {
      Alert.alert('保存失败', e.message || '更新配置失败');
    } finally {
      setIsSavingAI(false);
    }
  };

  const handleResetAI = async () => {
    setAiApiKey('');
    setAiBaseUrl('');
    setAiModel('');
    setAiSystemModel('grok-chat-fast');
    try {
      setIsSavingAI(true);
      await aiApi.updateAIConfig({
        apiKey: '',
        baseUrl: '',
        model: '',
        systemModel: 'grok-chat-fast',
      });
      setShowAIConfigModal(false);
      Alert.alert('已恢复默认', '已重置为系统预置的 Grok 智能创作模型');
    } catch (e: any) {
      Alert.alert('重置失败', e.message || '网络异常');
    } finally {
      setIsSavingAI(false);
    }
  };

  const handleLogout = () => {
    const doLogout = async () => {
      await logout();
      router.replace('/login');
    };

    if (Platform.OS === 'web') {
      if (window.confirm('确定要退出当前登录账号吗？')) {
        doLogout();
      }
      return;
    }

    Alert.alert('退出登录', '确定要退出当前登录账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: doLogout,
      },
    ]);
  };

  const handleTestPing = async (urlToTest: string) => {
    try {
      setIsTestingPing(true);
      const clean = urlToTest.trim().replace(/\/+$/, '');
      const res = await axios.get(`${clean}/api/auth/captcha?t=${Date.now()}`, { timeout: 5000 });
      if (res.status === 200) {
        if (Platform.OS === 'web') {
          window.alert(`成功联通服务器：\n${clean}`);
        } else {
          Alert.alert('连接测试成功', `成功联通服务器：\n${clean}`);
        }
      } else {
        if (Platform.OS === 'web') {
          window.alert(`服务响应异常（HTTP ${res.status}）`);
        } else {
          Alert.alert('连接告警', `服务响应异常（HTTP ${res.status}）`);
        }
      }
    } catch (e: any) {
      if (Platform.OS === 'web') {
        window.alert(`无法连通目标服务：\n${e.message}`);
      } else {
        Alert.alert('连接失败', `无法连通目标服务：\n${e.message}`);
      }
    } finally {
      setIsTestingPing(false);
    }
  };

  const handleSaveServer = async () => {
    if (!customUrl.trim()) return;
    await updateServerUrl(customUrl.trim());
    setShowServerModal(false);
    if (Platform.OS === 'web') {
      window.alert('服务器地址已切换');
    } else {
      Alert.alert('成功', '服务器地址已切换');
    }
  };

  const displayUser = (user as any)?.user || user;
  const username = displayUser?.username || '未登录用户';
  const email = displayUser?.email || '无邮箱信息';
  const role = displayUser?.role || '普通用户';
  const avatarChar = username && username !== '未登录用户' ? username.slice(0, 1).toUpperCase() : '囧';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 用户信息卡片 */}
      <View style={styles.profileCard}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{avatarChar}</Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={styles.username}>{username}</Text>
          <Text style={styles.userEmail}>{email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{role}</Text>
          </View>
        </View>
      </View>

      {/* 服务器环境切换 */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>服务节点与网络环境</Text>
      </View>

      <View style={styles.cardGroup}>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => {
            setCustomUrl(serverUrl);
            setShowServerModal(true);
          }}
          activeOpacity={0.7}
        >
          <View style={styles.itemLeft}>
            <View style={styles.serverIconWrapper}>
              <Ionicons name="server-outline" size={20} color="#1890ff" />
              <View style={styles.onlineDot} />
            </View>
            <View style={styles.serverTextCol}>
              <View style={styles.serverTitleRow}>
                <Text style={styles.itemTitle}>当前 API 节点</Text>
                <View style={styles.activePill}>
                  <Text style={styles.activePillText}>已连接</Text>
                </View>
              </View>
              <Text style={styles.itemSubMono} numberOfLines={1}>
                {serverUrl}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => handleTestPing(serverUrl)}
          disabled={isTestingPing}
          activeOpacity={0.7}
        >
          <View style={styles.itemLeft}>
            <Ionicons name="pulse-outline" size={20} color="#10b981" style={styles.itemIcon} />
            <Text style={styles.itemTitle}>测试当前节点连通性</Text>
          </View>
          {isTestingPing ? (
            <ActivityIndicator size="small" color="#10b981" />
          ) : (
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          )}
        </TouchableOpacity>
      </View>

      {/* AI 智能创作服务 */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>AI 智能创作服务</Text>
      </View>

      <View style={styles.cardGroup}>
        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => {
            loadAIConfig();
            setShowAIConfigModal(true);
          }}
          activeOpacity={0.7}
        >
          <View style={styles.itemLeft}>
            <View style={[styles.serverIconWrapper, { backgroundColor: '#f5f3ff' }]}>
              <Ionicons name="sparkles" size={18} color="#7c3aed" />
            </View>
            <View style={styles.serverTextCol}>
              <View style={styles.serverTitleRow}>
                <Text style={styles.itemTitle}>AI 大模型配置</Text>
                <View style={[styles.activePill, { backgroundColor: '#f5f3ff' }]}>
                  <Text style={[styles.activePillText, { color: '#7c3aed' }]}>
                    {aiModel || aiSystemModel || 'grok-chat-fast'}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemSubMono} numberOfLines={1}>
                {aiBaseUrl ? aiBaseUrl : '系统内置自建中转站 (开箱即用)'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      {/* 系统与关于 */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>应用信息</Text>
      </View>

      <View style={styles.cardGroup}>
        <View style={styles.settingItem}>
          <View style={styles.itemLeft}>
            <Ionicons name="information-circle-outline" size={20} color="#64748b" style={styles.itemIcon} />
            <Text style={styles.itemTitle}>应用名称</Text>
          </View>
          <Text style={styles.itemValue}>{Config.appName}</Text>
        </View>


        <View style={styles.settingItem}>
          <View style={styles.itemLeft}>
            <Ionicons name="git-branch-outline" size={20} color="#64748b" style={styles.itemIcon} />
            <Text style={styles.itemTitle}>当前版本</Text>
          </View>
          <Text style={styles.itemValueMono}>v{currentVersion} (Build {currentBuildNumber})</Text>
        </View>

        <TouchableOpacity
          style={styles.settingItem}
          onPress={() => checkForUpdates(true)}
          disabled={isCheckingUpdate}
          activeOpacity={0.7}
        >
          <View style={styles.itemLeft}>
            <Ionicons name="cloud-download-outline" size={20} color="#1890ff" style={styles.itemIcon} />
            <Text style={styles.itemTitle}>检查新版本</Text>
            {hasUpdate && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            )}
          </View>
          {isCheckingUpdate ? (
            <ActivityIndicator size="small" color="#1890ff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: hasUpdate ? '#1890ff' : '#94a3b8', marginRight: 4 }}>
                {hasUpdate ? '可更新' : '已是最新'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* 退出登录 */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color="#ef4444" style={{ marginRight: 6 }} />
        <Text style={styles.logoutText}>退出当前账号</Text>
      </TouchableOpacity>

      {/* 切换服务器弹窗 */}
      <Modal visible={showServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>切换后端服务器</Text>
            <Text style={styles.modalDesc}>
              支持在线上生产服与局域网调试环境无缝切换：
            </Text>

            <TextInput
              style={styles.modalInput}
              value={customUrl}
              onChangeText={setCustomUrl}
              placeholder="http://192.168.x.x:3001"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.quickSelectRow}>
              <TouchableOpacity
                style={styles.quickChip}
                onPress={() => setCustomUrl(Config.defaultServerUrl)}
              >
                <Text style={styles.quickChipText}>生产节点 (腾讯云)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickChip}
                onPress={() => setCustomUrl('http://192.168.1.100:3001')}
              >
                <Text style={styles.quickChipText}>本地示例 IP</Text>
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
                <Text style={styles.modalConfirmText}>保存生效</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI 配置弹窗 */}
      <Modal
        visible={showAIConfigModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAIConfigModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={18} color="#7c3aed" />
                <Text style={styles.modalTitle}>AI 智能服务配置</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIConfigModal(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              系统默认已配置免梯高速大模型（开箱即用）。选择您偏好的内置引擎：
            </Text>

            <Text style={styles.inputLabel}>系统内置引擎模型</Text>
            <View style={styles.mobileModelGrid}>
              {SYSTEM_MODELS.map(m => {
                const isSelected = aiSystemModel === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.mobileModelCard, isSelected && styles.mobileModelCardSelected]}
                    onPress={() => setAiSystemModel(m.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.mobileModelCardHeader}>
                      <Ionicons name={m.iconName} size={16} color={m.iconColor} />
                      <Text
                        style={[styles.mobileModelCardName, isSelected && { color: '#7c3aed', fontWeight: '700' }]}
                        numberOfLines={1}
                      >
                        {m.name}
                      </Text>
                    </View>
                    <View style={styles.mobileModelCardFooter}>
                      <Text style={styles.mobileModelBadge}>{m.badge}</Text>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={14} color="#7c3aed" />
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ height: 1, backgroundColor: '#f1f5f9', marginVertical: 10 }} />
            <Text style={styles.sectionSubTitle}>自定义兼容端点 (可选覆盖)</Text>

            <Text style={styles.inputLabel}>接口地址 (Base URL)</Text>
            <TextInput
              style={styles.modalInput}
              value={aiBaseUrl}
              onChangeText={setAiBaseUrl}
              placeholder="留空即使用系统默认自建站"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.inputLabel}>API 密钥 (API Key)</Text>
            <TextInput
              style={styles.modalInput}
              value={aiApiKey}
              onChangeText={setAiApiKey}
              placeholder="留空即使用系统默认密钥"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            <Text style={styles.inputLabel}>模型名称 (Model)</Text>
            <TextInput
              style={styles.modalInput}
              value={aiModel}
              onChangeText={setAiModel}
              placeholder="默认 grok-chat-fast"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 12 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { flex: 1, backgroundColor: '#f1f5f9', alignItems: 'center' }]}
                onPress={handleTestAI}
                disabled={isTestingAI}
              >
                {isTestingAI ? (
                  <ActivityIndicator size="small" color="#7c3aed" />
                ) : (
                  <Text style={{ fontSize: 13, color: '#475569', fontWeight: '600' }}>测试连通性</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, { flex: 1, backgroundColor: '#fef2f2', alignItems: 'center' }]}
                onPress={handleResetAI}
                disabled={isSavingAI}
              >
                <Text style={{ fontSize: 13, color: '#ef4444', fontWeight: '600' }}>恢复默认</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setShowAIConfigModal(false)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#7c3aed' }]}
                onPress={handleSaveAI}
                disabled={isSavingAI}
              >
                {isSavingAI ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.modalConfirmText}>保存配置</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1890ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  username: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  userEmail: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 6,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e6f7ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 11,
    color: '#1890ff',
    fontWeight: '600',
  },
  sectionHeader: {
    marginBottom: 8,
    paddingLeft: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  cardGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  itemIcon: {
    marginRight: 12,
  },
  serverIconWrapper: {
    position: 'relative',
    marginRight: 12,
  },
  onlineDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  serverTextCol: {
    flex: 1,
  },
  serverTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activePill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activePillText: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: '600',
  },
  itemTitle: {
    fontSize: 15,
    color: '#0f172a',
    fontWeight: '500',
  },
  itemSub: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
    maxWidth: 240,
  },
  itemSubMono: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    maxWidth: 240,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  itemValue: {
    fontSize: 14,
    color: '#64748b',
  },
  itemValueMono: {
    fontSize: 13,
    color: '#64748b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
    marginTop: 12,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ef4444',
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
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 5,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 14,
  },
  quickSelectRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  quickChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quickChipText: {
    fontSize: 12,
    color: '#1890ff',
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
  newBadge: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 6,
  },
  newBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  sectionSubTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  mobileModelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  mobileModelCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
  },
  mobileModelCardSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#faf5ff',
  },
  mobileModelCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  mobileModelCardName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1e293b',
    flex: 1,
  },
  mobileModelCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mobileModelBadge: {
    fontSize: 10,
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    fontWeight: '500',
  },
});
