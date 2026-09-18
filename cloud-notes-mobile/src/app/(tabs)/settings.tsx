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
import { Config } from '../../constants/Config';
import axios from 'axios';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, serverUrl, updateServerUrl, logout, refreshUser } = useAuth();

  const [showServerModal, setShowServerModal] = useState(false);
  const [customUrl, setCustomUrl] = useState(serverUrl);
  const [isTestingPing, setIsTestingPing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshUser();
    }, [refreshUser])
  );

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
            <Text style={styles.itemTitle}>版本号</Text>
          </View>
          <Text style={styles.itemValueMono}>v1.0.0 (MVP)</Text>
        </View>
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
});
