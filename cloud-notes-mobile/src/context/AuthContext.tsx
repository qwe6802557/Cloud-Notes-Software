import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';
import { User } from '../api/types';
import * as authApi from '../api/authApi';
import { getServerUrl, setOnUnauthorizedCallback, setServerUrl } from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  serverUrl: string;
  updateServerUrl: (url: string) => Promise<void>;
  login: (account: string, password: string, captcha?: string, captchaKey?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [serverUrl, setLocalServerUrl] = useState<string>(getServerUrl());

  // 初始化鉴权状态
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedServerUrl = await AsyncStorage.getItem(Config.storageKeys.serverUrl);
        if (storedServerUrl) {
          setLocalServerUrl(storedServerUrl);
          await setServerUrl(storedServerUrl);
        }

        const storedToken = await AsyncStorage.getItem(Config.storageKeys.token);
        const storedUser = await AsyncStorage.getItem(Config.storageKeys.user);

        if (storedToken) {
          setToken(storedToken);
          if (storedUser) {
            setUser(JSON.parse(storedUser));
          }

          // 验证 Token 有效性并静默拉取最新用户信息
          try {
            const res = await authApi.getCurrentUser();
            if (res && res.code === 200 && res.data) {
              setUser(res.data);
              await AsyncStorage.setItem(Config.storageKeys.user, JSON.stringify(res.data));
            }
          } catch (err: any) {
            // 若 401，拦截器已清理凭证
            console.warn('Silent auth check failed:', err.message);
          }
        }
      } catch (e) {
        console.error('Failed to restore auth state', e);
      } finally {
        setIsLoading(false);
      }
    };

    // 绑定 401 自动登出回调
    setOnUnauthorizedCallback(() => {
      setToken(null);
      setUser(null);
    });

    initAuth();
  }, []);

  const updateServerUrl = async (newUrl: string) => {
    await setServerUrl(newUrl);
    setLocalServerUrl(newUrl);
  };

  const login = async (account: string, password: string, captcha?: string, captchaKey?: string) => {
    const res = await authApi.login({ account, password, captcha, captchaKey });
    if (res.code === 200 && res.data) {
      const { user: loggedInUser, token: receivedToken } = res.data;
      setUser(loggedInUser);
      setToken(receivedToken);

      await AsyncStorage.setItem(Config.storageKeys.token, receivedToken);
      await AsyncStorage.setItem(Config.storageKeys.user, JSON.stringify(loggedInUser));
    } else {
      throw new Error(res.message || '登录失败');
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (e) {}

    await AsyncStorage.removeItem(Config.storageKeys.token);
    await AsyncStorage.removeItem(Config.storageKeys.user);
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    const res = await authApi.getCurrentUser();
    if (res.code === 200 && res.data) {
      setUser(res.data);
      await AsyncStorage.setItem(Config.storageKeys.user, JSON.stringify(res.data));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        serverUrl,
        updateServerUrl,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
