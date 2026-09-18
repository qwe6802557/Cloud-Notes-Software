import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isIos = Platform.OS === 'ios';

  // 动态自适应安全区底边距：
  // iOS 全面屏使用 insets.bottom（通常 34），无安全区（Android / Web / iPhone SE）时保留极简 4px 边距
  const bottomInset = insets.bottom > 0 ? insets.bottom : (isIos ? 20 : 4);
  // 保证 Tab 项内部拥有 60px 的充足视觉高度，使图标与标签文字完整舒展
  const tabHeight = 60 + bottomInset;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#1890ff',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: tabHeight,
          paddingTop: 2,
          paddingBottom: bottomInset,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          lineHeight: 14,
          marginTop: 2,
          marginBottom: 0,
        },
        headerStyle: {
          backgroundColor: '#ffffff',
        },
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
          color: '#0f172a',
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '全部笔记',
          tabBarLabel: '笔记',
          tabBarIcon: ({ color }) => (
            <Ionicons name="document-text-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notebooks"
        options={{
          title: '笔记本',
          tabBarLabel: '笔记本',
          tabBarIcon: ({ color }) => (
            <Ionicons name="folder-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '我的设置',
          tabBarLabel: '我的',
          tabBarIcon: ({ color }) => (
            <Ionicons name="person-circle-outline" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

