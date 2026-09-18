import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';
import { ApiResponse } from './types';

let currentServerUrl = Config.defaultServerUrl;
let onUnauthorizedCallback: (() => void) | null = null;

export const setOnUnauthorizedCallback = (cb: () => void) => {
  onUnauthorizedCallback = cb;
};

export const getServerUrl = () => currentServerUrl;

export const setServerUrl = async (url: string) => {
  const cleanUrl = url.trim().replace(/\/+$/, '');
  currentServerUrl = cleanUrl;
  await AsyncStorage.setItem(Config.storageKeys.serverUrl, cleanUrl);
  axiosInstance.defaults.baseURL = `${cleanUrl}/api`;
};

// 初始化创建 Axios 实例
const axiosInstance: AxiosInstance = axios.create({
  baseURL: `${currentServerUrl}/api`,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json;charset=UTF-8',
  },
});

// 从本地存储装载上次配置的服务器地址
(async () => {
  if (typeof window === 'undefined' && Platform.OS === 'web') return;
  try {
    const savedUrl = await AsyncStorage.getItem(Config.storageKeys.serverUrl);
    if (savedUrl) {
      currentServerUrl = savedUrl;
      axiosInstance.defaults.baseURL = `${savedUrl}/api`;
    }
  } catch (e) {
    // 忽略 SSR 或首屏异步读取警告
  }
})();

// 请求拦截器：动态追加 JWT Token 及防缓存时间戳
axiosInstance.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem(Config.storageKeys.token);
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn('Failed to attach token', e);
    }

    if (config.method === 'get') {
      config.params = config.params || {};
      config.params.t = Date.now();
    }

    if (Platform.OS === 'web' && typeof FormData !== 'undefined' && config.data instanceof FormData) {
      if (config.headers) {
        if (typeof (config.headers as any).delete === 'function') {
          (config.headers as any).delete('Content-Type');
          (config.headers as any).delete('content-type');
        } else {
          delete (config.headers as any)['Content-Type'];
          delete (config.headers as any)['content-type'];
        }
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器：统一格式提取与 401 鉴权失效拦截
axiosInstance.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  async (error) => {
    if (error.response && error.response.status === 401) {
      // Token 过期或未授权，清理本地凭据并唤起重新登录
      try {
        await AsyncStorage.removeItem(Config.storageKeys.token);
        await AsyncStorage.removeItem(Config.storageKeys.user);
      } catch (e) {}

      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }

    const message = error.response?.data?.message || error.message || '网络请求错误，请稍后重试';
    return Promise.reject(new Error(message));
  }
);

export default axiosInstance;
