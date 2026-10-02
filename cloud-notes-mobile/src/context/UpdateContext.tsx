import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Updates from 'expo-updates';
import { checkAppUpdate, AppUpdateData } from '../api/updateApi';

interface UpdateContextType {
  currentVersion: string;
  currentBuildNumber: number;
  isChecking: boolean;
  hasUpdate: boolean;
  updateData: AppUpdateData | null;
  isModalVisible: boolean;
  isDownloading: boolean;
  downloadProgress: number; // 0 - 100
  downloadedBytes: number;
  totalBytes: number;
  isCompleted: boolean;
  checkForUpdates: (isManual?: boolean) => Promise<void>;
  startUpdate: () => Promise<void>;
  dismissModal: () => void;
}

const UpdateContext = createContext<UpdateContextType | null>(null);

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const currentVersion = Constants.expoConfig?.version || '1.0.0';
  const currentBuildNumber =
    (Platform.OS === 'android'
      ? Constants.expoConfig?.android?.versionCode
      : Constants.expoConfig?.ios?.buildNumber) || 1;

  const isCheckingRef = useRef(false);
  const [isChecking, setIsChecking] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateData, setUpdateData] = useState<AppUpdateData | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);

  // 下载进度状态
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  /**
   * 检查更新
   * @param isManual 是否由用户手动点击触发
   */
  const checkForUpdates = useCallback(
    async (isManual = false) => {
      if (isCheckingRef.current) return;
      try {
        isCheckingRef.current = true;
        setIsChecking(true);
        const platformKey = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

        const res = await checkAppUpdate({
          platform: platformKey,
          currentVersion,
          buildNumber: Number(currentBuildNumber) || 1,
        });

        console.log('[UpdateCheck] 检查结果:', res);

        if (res.code === 200 && res.data && res.data.hasUpdate) {
          setHasUpdate(true);
          setUpdateData(res.data);
          setIsModalVisible(true);
        } else {
          setHasUpdate(false);
          setUpdateData(null);
          if (isManual) {
            Alert.alert(
              '当前已是最新版',
              `当前应用版本 v${currentVersion} (Build ${currentBuildNumber}) 已是最新版，无需更新。`
            );
          }
        }
      } catch (err: any) {
        console.warn('检查应用更新失败:', err.message);
        if (isManual) {
          Alert.alert('检查更新失败', '网络连接超时或服务器暂不可用，请稍后重试。');
        }
      } finally {
        isCheckingRef.current = false;
        setIsChecking(false);
      }
    },
    [currentVersion, currentBuildNumber]
  );

  /**
   * 执行更新
   */
  const startUpdate = useCallback(async () => {
    if (!updateData) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    setIsCompleted(false);

    try {
      if (updateData.type === 'ota') {
        // ========== 分支 1：OTA 热更新 ==========
        if (Updates.isEnabled) {
          // 生产独立安装包中，调用 expo-updates 原生热更
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            // 模拟进度条平滑视觉反馈
            const timer = setInterval(() => {
              setDownloadProgress(prev => {
                if (prev >= 90) {
                  clearInterval(timer);
                  return 90;
                }
                return prev + 15;
              });
            }, 200);

            await Updates.fetchUpdateAsync();
            clearInterval(timer);
            setDownloadProgress(100);
            setIsCompleted(true);

            setTimeout(async () => {
              await Updates.reloadAsync();
            }, 800);
            return;
          }
        }

        // 开发环境或自托管 Bundle 兜底下载
        if (updateData.downloadUrl) {
          const targetFile = `${FileSystem.cacheDirectory}hot-update-${updateData.version}.zip`;
          const downloadResumable = FileSystem.createDownloadResumable(
            updateData.downloadUrl,
            targetFile,
            {},
            downloadProgressEvent => {
              const { totalBytesWritten, totalBytesExpectedToWrite } = downloadProgressEvent;
              setDownloadedBytes(totalBytesWritten);
              setTotalBytes(totalBytesExpectedToWrite);
              if (totalBytesExpectedToWrite > 0) {
                const percent = Math.min(
                  100,
                  Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
                );
                setDownloadProgress(percent);
              }
            }
          );

          await downloadResumable.downloadAsync();
          setDownloadProgress(100);
          setIsCompleted(true);

          if (Updates.isEnabled) {
            setTimeout(async () => {
              await Updates.reloadAsync();
            }, 800);
          } else {
            setIsDownloading(false);
            Alert.alert(
              '热更包就绪',
              `已成功下载热更资源（v${updateData.version}）。在生产 APK 安装包中此时将瞬间重启生效！`
            );
          }
        } else {
          Alert.alert('更新失败', '热更包资源地址不存在');
          setIsDownloading(false);
        }
      } else {
        // ========== 分支 2：原生整包 APK 安装更新 ==========
        if (Platform.OS === 'android') {
          const apkTarget = `${FileSystem.cacheDirectory}cloud-notes-v${updateData.version}.apk`;
          const apkUrl = updateData.apkUrl || updateData.downloadUrl;

          if (!apkUrl) {
            Alert.alert('更新失败', '安装包下载地址为空');
            setIsDownloading(false);
            return;
          }

          const downloadResumable = FileSystem.createDownloadResumable(
            apkUrl,
            apkTarget,
            {},
            progressEvent => {
              const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
              setDownloadedBytes(totalBytesWritten);
              setTotalBytes(totalBytesExpectedToWrite);
              if (totalBytesExpectedToWrite > 0) {
                const percent = Math.min(
                  100,
                  Math.round((totalBytesWritten / totalBytesExpectedToWrite) * 100)
                );
                setDownloadProgress(percent);
              }
            }
          );

          const result = await downloadResumable.downloadAsync();
          setDownloadProgress(100);
          setIsCompleted(true);

          if (result?.uri) {
            try {
              const contentUri = await FileSystem.getContentUriAsync(result.uri);
              await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                data: contentUri,
                flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
                type: 'application/vnd.android.package-archive',
              });
            } catch (intentErr: any) {
              console.warn('拉起安装器失败，尝试系统浏览器打开:', intentErr.message);
              await Linking.openURL(apkUrl);
            }
          }
        } else {
          // iOS 或其他平台跳转链接
          const targetUrl = updateData.apkUrl || updateData.downloadUrl;
          if (targetUrl) {
            await Linking.openURL(targetUrl);
          }
        }
        setIsDownloading(false);
      }
    } catch (err: any) {
      console.error('更新执行异常:', err);
      Alert.alert('更新失败', err.message || '下载更新资源发生异常，请检查网络后重试');
      setIsDownloading(false);
    }
  }, [updateData]);

  const dismissModal = () => {
    if (updateData?.forceUpdate) {
      Alert.alert('必须更新', '当前版本包含关键功能升级，请完成更新后再使用应用。');
      return;
    }
    setIsModalVisible(false);
  };

  // 启动时主动静默检测一次
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdates(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        currentVersion,
        currentBuildNumber: Number(currentBuildNumber) || 1,
        isChecking,
        hasUpdate,
        updateData,
        isModalVisible,
        isDownloading,
        downloadProgress,
        downloadedBytes,
        totalBytes,
        isCompleted,
        checkForUpdates,
        startUpdate,
        dismissModal,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};

export const useAppUpdate = () => {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useAppUpdate 必须在 UpdateProvider 内使用');
  }
  return context;
};
