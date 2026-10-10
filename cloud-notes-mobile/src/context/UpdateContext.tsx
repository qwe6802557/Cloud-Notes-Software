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
  openInstallPermissionSettings: () => Promise<void>;
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

          // 双模策略：普通热更启动时后台静默下载，不弹窗打扰；强更、原生升级或手动点击时弹窗
          if (res.data.type === 'ota' && Updates.isEnabled) {
            if (!isManual && !res.data.forceUpdate) {
              setIsModalVisible(false);
              Updates.checkForUpdateAsync()
                .then(u => {
                  if (u.isAvailable) {
                    Updates.fetchUpdateAsync()
                      .then(() => console.log('[Update] 静默热更补丁拉取完毕，下次启动生效'))
                      .catch(err => console.warn('[Update] 静默下载异常:', err.message));
                  }
                })
                .catch(err => console.warn('[Update] 静默检测异常:', err.message));
              return;
            }
          }

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
   * 跳转系统设置开启未知应用安装权限
   */
  const openInstallPermissionSettings = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.MANAGE_UNKNOWN_APP_SOURCES',
        { data: 'package:com.jiongren.cloudnotes' }
      );
    } catch {
      try {
        await IntentLauncher.startActivityAsync(
          'android.settings.APPLICATION_DETAILS_SETTINGS',
          { data: 'package:com.jiongren.cloudnotes' }
        );
      } catch {
        Linking.openSettings();
      }
    }
  }, []);

  /**
   * 执行更新
   */
  const startUpdate = useCallback(async () => {
    if (!updateData) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    setIsCompleted(false);

    try {
      const handleApkDownloadAndInstall = async (apkUrl: string, version: string) => {
        if (Platform.OS === 'android') {
          const buildCode = updateData.buildNumber || 1;
          const hashTag = (updateData.hash || '').substring(0, 8);
          const apkTarget = `${FileSystem.cacheDirectory}cloud-notes-v${version}-b${buildCode}-${hashTag}.apk`;
          let apkFileUri = apkTarget;

          // 严格校验本地缓存：文件必须存在且体积完全等于服务器声明的字节数（误差为 0）
          const cachedInfo = await FileSystem.getInfoAsync(apkTarget);
          const isCacheValid =
            cachedInfo.exists &&
            cachedInfo.size &&
            updateData.size &&
            cachedInfo.size === updateData.size;

          if (isCacheValid) {
            console.log('[Update] 命中精确匹配的本地安装包:', apkTarget);
            setDownloadProgress(100);
            setIsCompleted(true);
          } else {
            // 清理旧缓存或损坏的文件
            if (cachedInfo.exists) {
              await FileSystem.deleteAsync(apkTarget, { idempotent: true });
            }

            // 防网络 CDN 缓存时间戳
            const downloadUrl = apkUrl.includes('?')
              ? `${apkUrl}&_t=${Date.now()}`
              : `${apkUrl}?_t=${Date.now()}`;

            const downloadResumable = FileSystem.createDownloadResumable(
              downloadUrl,
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
              apkFileUri = result.uri;
            }
          }

          if (apkFileUri) {
            try {
              const contentUri = await FileSystem.getContentUriAsync(apkFileUri);
              await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                data: contentUri,
                flags: 268435457, // FLAG_GRANT_READ_URI_PERMISSION (1) | FLAG_ACTIVITY_NEW_TASK (0x10000000)
                type: 'application/vnd.android.package-archive',
              });
              setIsModalVisible(false);
            } catch (intentErr: any) {
              console.warn('拉起安装器失败，尝试引导开启权限:', intentErr.message);
              Alert.alert(
                '安装权限受阻',
                '系统需要安装未知应用权限才能完成自动升级。请开启权限，或直接在浏览器中下载安装。',
                [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '去开启权限',
                    onPress: () => openInstallPermissionSettings(),
                  },
                  {
                    text: '浏览器下载',
                    onPress: () => {
                      setIsModalVisible(false);
                      Linking.openURL(apkUrl);
                    },
                  },
                ]
              );
            }
          }
        } else {
          // iOS 或其他平台跳转链接
          await Linking.openURL(apkUrl);
          setIsModalVisible(false);
        }
      };

      if (updateData.type === 'ota' && Updates.isEnabled) {
        setIsDownloading(true);
        setDownloadProgress(20);
        setIsCompleted(false);

        try {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            setDownloadProgress(60);
            await Updates.fetchUpdateAsync();
            setDownloadProgress(100);
            setIsCompleted(true);

            setTimeout(async () => {
              await Updates.reloadAsync();
            }, 600);
            return;
          } else {
            setDownloadProgress(100);
            setIsCompleted(true);
            setTimeout(async () => {
              await Updates.reloadAsync();
            }, 600);
            return;
          }
        } catch (otaErr: any) {
          console.warn('[Update] Expo Updates 触发异常，降级执行 APK 流程:', otaErr.message);
        }
      }

      // ========== 分支 2：原生整包 APK 安装更新（或 OTA 不受原生支持时自动降级整包） ==========
      const targetApkUrl = updateData.apkUrl || (updateData.type === 'native' ? updateData.downloadUrl : '');
      if (targetApkUrl) {
        await handleApkDownloadAndInstall(targetApkUrl, updateData.version);
        setIsDownloading(false);
      } else if (updateData.downloadUrl) {
        // 自托管 Bundle 兜底模式（仅在开发/调试环境具备运行时热载能力时有效）
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
        setIsDownloading(false);
        setIsModalVisible(false);

        Alert.alert(
          '热更包已下载',
          `版本资源 (v${updateData.version}) 已缓存至本地。如未自动生效，请安装最新版 APK 升级。`
        );
      } else {
        Alert.alert('更新失败', '未获取到有效的升级下载地址');
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
        openInstallPermissionSettings,
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
