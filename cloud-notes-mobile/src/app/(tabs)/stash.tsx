import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as stashApi from '../../api/stashApi';
import { StashFile } from '../../api/stashApi';
import FilePreviewModal from '../../components/FilePreviewModal';

const formatBytes = (bytes: number, decimals = 1) => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatCountdown = (totalSeconds: number | null) => {
  if (!totalSeconds || totalSeconds <= 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const getFileIcon = (filename: string = '', mimetype: string = '') => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) || mimetype.startsWith('image/')) {
    return { name: 'image-outline' as const, color: '#2563eb', bg: '#eff6ff' };
  }
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'md'].includes(ext) || mimetype.includes('pdf') || mimetype.includes('document')) {
    return { name: 'document-text-outline' as const, color: '#ea580c', bg: '#fff7ed' };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || mimetype.includes('zip') || mimetype.includes('compressed')) {
    return { name: 'archive-outline' as const, color: '#9333ea', bg: '#faf5ff' };
  }
  if (['mp4', 'mov', 'avi', 'mp3', 'wav'].includes(ext) || mimetype.startsWith('video/') || mimetype.startsWith('audio/')) {
    return { name: 'videocam-outline' as const, color: '#dc2626', bg: '#fef2f2' };
  }
  if (['js', 'ts', 'tsx', 'py', 'json', 'html', 'css'].includes(ext)) {
    return { name: 'code-slash-outline' as const, color: '#16a34a', bg: '#f0fdf4' };
  }
  return { name: 'document-outline' as const, color: '#64748b', bg: '#f1f5f9' };
};

interface VirtualFolder {
  name: string;
  fullPath: string;
  topLevelFolder: string;
  files: StashFile[];
  totalSize: number;
  minRemaining: number | null;
}

export default function StashScreen() {
  const [currentTab, setCurrentTab] = useState<'temp' | 'permanent'>('temp');
  const [files, setFiles] = useState<StashFile[]>([]);
  const [tempCount, setTempCount] = useState(0);
  const [permanentCount, setPermanentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showPickerSheet, setShowPickerSheet] = useState(false);

  // 文件沉浸式全屏预览状态
  const [previewFile, setPreviewFile] = useState<StashFile | null>(null);

  // 虚拟目录导航层级状态：'' 表示根目录
  const [currentPath, setCurrentPath] = useState('');

  // 原生移动端文件夹名称输入弹窗
  const [showFolderNameModal, setShowFolderNameModal] = useState(false);
  const [folderNameInput, setFolderNameInput] = useState('');

  // 批量上传进度状态
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [batchCurrentIndex, setBatchCurrentIndex] = useState(0);
  const [batchTotalCount, setBatchTotalCount] = useState(0);
  const [currentUploadingFileName, setCurrentUploadingFileName] = useState('');

  // Web 端隐藏的文件夹 input 引用
  const webFolderInputRef = useRef<any>(null);

  // 切换 tab 时重置当前路径与预览状态
  useEffect(() => {
    setCurrentPath('');
    setPreviewFile(null);
  }, [currentTab]);

  // 拉取暂存文件列表
  const loadFiles = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);

      const res = await stashApi.getStashFiles(currentTab);
      if (res.code === 200 && res.data) {
        setFiles(res.data.files || []);
        setTempCount(res.data.tempCount ?? 0);
        setPermanentCount(res.data.permanentCount ?? 0);
      }
    } catch (e: any) {
      console.warn('Fetch stash files failed:', e.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentTab]);

  useFocusEffect(
    useCallback(() => {
      loadFiles();
    }, [loadFiles])
  );

  // 10 分钟倒计时秒级递减驱动
  useEffect(() => {
    if (currentTab !== 'temp') return;

    const interval = setInterval(() => {
      setFiles(prev => {
        let hasExpired = false;
        const next = prev
          .map(f => {
            if (f.storageType !== 'temp') return f;
            const nextSec = (f.remainingSeconds ?? 0) - 1;
            if (nextSec <= 0) {
              hasExpired = true;
              return null;
            }
            return { ...f, remainingSeconds: nextSec };
          })
          .filter(Boolean) as StashFile[];

        if (hasExpired) {
          setTempCount(next.length);
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [currentTab]);

  // 计算当前层级的虚拟目录与文件
  const viewData = useMemo(() => {
    const prefix = currentPath ? `${currentPath}/` : '';
    const folderMap = new Map<string, VirtualFolder>();
    const directFiles: StashFile[] = [];

    files.forEach(file => {
      let relPath = (file.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!relPath) {
        if (file.folderName) {
          relPath = `${file.folderName}/${file.originalName}`;
        } else {
          relPath = file.originalName || file.filename;
        }
      }

      if (prefix) {
        if (!relPath.startsWith(prefix)) {
          return;
        }
        relPath = relPath.slice(prefix.length);
      }

      if (relPath.includes('/')) {
        const subFolderName = relPath.split('/')[0];
        const fullSubFolderPath = currentPath ? `${currentPath}/${subFolderName}` : subFolderName;

        if (!folderMap.has(subFolderName)) {
          folderMap.set(subFolderName, {
            name: subFolderName,
            fullPath: fullSubFolderPath,
            topLevelFolder: fullSubFolderPath.split('/')[0],
            files: [],
            totalSize: 0,
            minRemaining: null,
          });
        }
        const folder = folderMap.get(subFolderName)!;
        folder.files.push(file);
        folder.totalSize += file.size || 0;
        if (file.remainingSeconds != null) {
          folder.minRemaining =
            folder.minRemaining == null
              ? file.remainingSeconds
              : Math.min(folder.minRemaining, file.remainingSeconds);
        }
      } else {
        directFiles.push(file);
      }
    });

    return {
      folders: Array.from(folderMap.values()),
      files: directFiles,
    };
  }, [files, currentPath]);

  // 批量文件上传执行队列
  const uploadBatchFiles = async (
    items: Array<{
      uri: string;
      name: string;
      type: string;
      size?: number;
      file?: any;
      relativePath: string;
      folderName?: string;
    }>
  ) => {
    if (items.length === 0) return;

    setIsBatchUploading(true);
    setBatchTotalCount(items.length);
    setBatchCurrentIndex(0);

    const batchExpireAt =
      currentTab === 'temp'
        ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
        : undefined;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setBatchCurrentIndex(i + 1);
      setCurrentUploadingFileName(item.name);

      try {
        await stashApi.uploadStashFile(
          {
            uri: item.uri,
            name: item.name,
            type: item.type,
            file: item.file,
            relativePath: item.relativePath,
            folderName: item.folderName,
          },
          currentTab,
          batchExpireAt
        );
        successCount++;
      } catch (err: any) {
        console.error(`上传失败: ${item.name}`, err);
        failCount++;
      }
    }

    setIsBatchUploading(false);
    loadFiles(true);

    if (failCount > 0) {
      Alert.alert('批量上传结果', `成功上传 ${successCount} 个文件，${failCount} 个失败`);
    } else {
      Alert.alert('上传完成', `成功上传全部 ${successCount} 个文件至【${currentTab === 'temp' ? '临时' : '永久'}】区`);
    }
  };

  // 从相册选取单文件
  const handlePickFromLibrary = async () => {
    setShowPickerSheet(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const MAX_SIZE = 100 * 1024 * 1024;
        if (asset.fileSize && asset.fileSize > MAX_SIZE) {
          Alert.alert('上传失败', '文件超过 100MB 限制');
          return;
        }

        setIsUploading(true);
        const fileName = asset.fileName || `stash_${Date.now()}.jpg`;
        const relPath = currentPath ? `${currentPath}/${fileName}` : fileName;

        await stashApi.uploadStashFile(
          {
            uri: asset.uri,
            name: fileName,
            type: asset.mimeType || 'image/jpeg',
            file: (asset as any).file,
            relativePath: relPath,
            folderName: currentPath ? currentPath.split('/')[0] : undefined,
          },
          currentTab
        );
        Alert.alert('提示', currentTab === 'temp' ? '临时文件已暂存（10分钟后自动销毁）' : '文件已永久保存');
        loadFiles(true);
      }
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '网络异常，请重试');
    } finally {
      setIsUploading(false);
    }
  };

  // 从手机系统文件选取单文件
  const handlePickFromDocuments = async () => {
    setShowPickerSheet(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const MAX_SIZE = 100 * 1024 * 1024;
        if (asset.size && asset.size > MAX_SIZE) {
          Alert.alert('上传失败', '文件超过 100MB 限制');
          return;
        }

        setIsUploading(true);
        const relPath = currentPath ? `${currentPath}/${asset.name}` : asset.name;

        await stashApi.uploadStashFile(
          {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType || 'application/octet-stream',
            file: (asset as any).file,
            relativePath: relPath,
            folderName: currentPath ? currentPath.split('/')[0] : undefined,
          },
          currentTab
        );
        Alert.alert('提示', currentTab === 'temp' ? '临时文件已暂存（10分钟后自动销毁）' : '文件已永久保存');
        loadFiles(true);
      }
    } catch (e: any) {
      Alert.alert('上传失败', e.message || '选择或上传文件失败');
    } finally {
      setIsUploading(false);
    }
  };

  // 文件夹上传触发入口
  const handlePickFolder = () => {
    setShowPickerSheet(false);
    if (Platform.OS === 'web') {
      // Web 端触发原生目录选择
      if (webFolderInputRef.current) {
        webFolderInputRef.current.click();
      }
    } else {
      // 移动原生端弹出文件夹名称确认弹窗
      setFolderNameInput(currentPath ? '' : `资料包_${new Date().getMonth() + 1}${new Date().getDate()}`);
      setShowFolderNameModal(true);
    }
  };

  // Web 端文件夹选择监听处理
  const handleWebFolderInputChange = async (e: any) => {
    const selectedFiles = Array.from(e.target.files || []) as File[];
    e.target.value = '';
    if (selectedFiles.length === 0) return;

    const items = selectedFiles.map(file => {
      const rawRel = (file as any).webkitRelativePath || file.name;
      const fullRel = currentPath ? `${currentPath}/${rawRel}` : rawRel;
      const topFolder = fullRel.includes('/') ? fullRel.split('/')[0] : '';
      return {
        uri: '',
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        file,
        relativePath: fullRel,
        folderName: topFolder,
      };
    });

    await uploadBatchFiles(items);
  };

  // 移动端选取多文件打包为指定文件夹
  const handleNativeFolderConfirm = async () => {
    const targetFolder = folderNameInput.trim() || `文件夹_${Date.now()}`;
    setShowFolderNameModal(false);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const items = result.assets.map(asset => {
          const fullRel = currentPath
            ? `${currentPath}/${targetFolder}/${asset.name}`
            : `${targetFolder}/${asset.name}`;
          const topFolder = fullRel.split('/')[0];

          return {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType || 'application/octet-stream',
            size: asset.size,
            file: (asset as any).file,
            relativePath: fullRel,
            folderName: topFolder,
          };
        });

        await uploadBatchFiles(items);
      }
    } catch (e: any) {
      Alert.alert('文件夹选择失败', e.message || '选取文件异常');
    }
  };

  // 复制直链
  const handleCopyUrl = async (file: StashFile) => {
    if (!file.url) return;
    try {
      await Clipboard.setStringAsync(file.url);
      Alert.alert('复制成功', '文件直链已存入剪贴板，可粘贴发送或在浏览器中打开');
    } catch {
      Alert.alert('文件直链', file.url);
    }
  };

  // 下载或直接打开单文件
  const handleOpenUrl = (file: StashFile) => {
    if (file.url) {
      Linking.openURL(file.url).catch(() => {
        Alert.alert('打开失败', '无法打开此文件链接');
      });
    }
  };

  // 单文件临时转永久
  const handlePromote = async (file: StashFile) => {
    try {
      await stashApi.promoteStashFile(file._id || file.id || '');
      Alert.alert('成功', `【${file.originalName}】已升级为永久文件`);
      if (previewFile && ((previewFile._id || previewFile.id) === (file._id || file.id))) {
        setPreviewFile(prev => (prev ? { ...prev, storageType: 'permanent' } : null));
      }
      loadFiles(true);
    } catch (e: any) {
      Alert.alert('操作失败', e.message || '转为永久保存失败');
    }
  };

  // 删除单文件
  const handleDelete = (file: StashFile) => {
    Alert.alert('确认删除', `确定要彻底删除文件【${file.originalName}】吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '彻底删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await stashApi.deleteStashFile(file._id || file.id || '');
            if (previewFile && ((previewFile._id || previewFile.id) === (file._id || file.id))) {
              setPreviewFile(null);
            }
            loadFiles(true);
          } catch (e: any) {
            Alert.alert('删除失败', e.message || '网络异常');
          }
        },
      },
    ]);
  };

  // 进入虚拟目录
  const handleEnterFolder = (folder: VirtualFolder) => {
    setCurrentPath(folder.fullPath);
  };

  // 回退上一级
  const handleGoBack = () => {
    if (!currentPath) return;
    const parts = currentPath.split('/');
    parts.pop();
    setCurrentPath(parts.join('/'));
  };

  // 文件夹打包整包下载 (ZIP)
  const handleDownloadFolder = async (folder: VirtualFolder) => {
    try {
      const downloadUrl = await stashApi.getFolderDownloadUrl(folder.topLevelFolder, currentTab);
      Linking.openURL(downloadUrl).catch(() => {
        Alert.alert('下载失败', '无法唤起浏览器下载打包文件');
      });
    } catch (err: any) {
      Alert.alert('打包下载异常', err.message || '下载请求失败');
    }
  };

  // 文件夹整包转永久
  const handlePromoteFolder = async (folder: VirtualFolder) => {
    try {
      await stashApi.promoteStashFolder(folder.topLevelFolder);
      Alert.alert('成功', `文件夹【${folder.name}】及内部所有文件已全部转为永久保存`);
      loadFiles(true);
    } catch (e: any) {
      Alert.alert('操作失败', e.message || '文件夹转为永久保存失败');
    }
  };

  // 彻底删除整个文件夹
  const handleDeleteFolder = (folder: VirtualFolder) => {
    Alert.alert(
      '确认删除文件夹',
      `确定要彻底删除文件夹【${folder.name}】及其内部所有 ${folder.files.length} 个文件吗？此操作不可撤回。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '彻底删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await stashApi.deleteStashFolder(folder.topLevelFolder, currentTab);
              Alert.alert('已删除', `文件夹【${folder.name}】已成功清理`);
              loadFiles(true);
            } catch (e: any) {
              Alert.alert('删除失败', e.message || '网络异常');
            }
          },
        },
      ]
    );
  };

  // 渲染虚拟文件夹卡片
  const renderFolderCard = (folder: VirtualFolder) => {
    const isTemp = currentTab === 'temp';
    const remaining = folder.minRemaining ?? 0;
    const isUrgent = isTemp && remaining > 0 && remaining <= 60;

    return (
      <View key={`folder_${folder.fullPath}`} style={[styles.card, styles.folderCard]}>
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => handleEnterFolder(folder)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconBox, styles.folderIconBox]}>
            <Ionicons name="folder" size={24} color="#d97706" />
          </View>
          <View style={styles.cardMetaCol}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.folderCardTitle} numberOfLines={1}>
                {folder.name}
              </Text>
              <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
            </View>
            <View style={styles.cardSubRow}>
              <Text style={styles.cardSize}>
                {folder.files.length} 个文件 · {formatBytes(folder.totalSize)}
              </Text>
              {isTemp ? (
                <View style={[styles.badgePill, isUrgent && styles.badgeUrgent]}>
                  <View style={[styles.badgeDot, isUrgent && styles.badgeDotUrgent]} />
                  <Text style={[styles.badgeText, isUrgent && styles.badgeTextUrgent]}>
                    剩余 {formatCountdown(remaining)}
                  </Text>
                </View>
              ) : (
                <View style={styles.permanentPill}>
                  <Text style={styles.permanentText}>永久文件夹</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {/* 文件夹操作快捷栏 */}
        <View style={styles.cardActionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleEnterFolder(folder)}>
            <Ionicons name="open-outline" size={15} color="#2563eb" />
            <Text style={[styles.actionBtnText, { color: '#2563eb' }]}>进入查看</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => handleDownloadFolder(folder)}>
            <Ionicons name="archive-outline" size={15} color="#7c3aed" />
            <Text style={[styles.actionBtnText, { color: '#7c3aed' }]}>打包 ZIP</Text>
          </TouchableOpacity>

          {isTemp && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handlePromoteFolder(folder)}>
              <Ionicons name="bookmark-outline" size={15} color="#d97706" />
              <Text style={[styles.actionBtnText, { color: '#d97706' }]}>整包转永久</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => handleDeleteFolder(folder)}
          >
            <Ionicons name="trash-outline" size={15} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // 渲染单文件卡片
  const renderFileCard = (item: StashFile) => {
    const meta = getFileIcon(item.originalName, item.mimetype);
    const isTemp = item.storageType === 'temp';
    const remaining = item.remainingSeconds ?? 0;
    const isUrgent = isTemp && remaining <= 60;

    return (
      <View key={item._id || item.id} style={styles.card}>
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => setPreviewFile(item)}
          activeOpacity={0.7}
        >
          <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.name} size={22} color={meta.color} />
          </View>
          <View style={styles.cardMetaCol}>
            <Text style={styles.cardTitle} numberOfLines={1} ellipsizeMode="middle">
              {item.originalName}
            </Text>
            <View style={styles.cardSubRow}>
              <Text style={styles.cardSize}>{formatBytes(item.size)}</Text>
              {isTemp ? (
                <View style={[styles.badgePill, isUrgent && styles.badgeUrgent]}>
                  <View style={[styles.badgeDot, isUrgent && styles.badgeDotUrgent]} />
                  <Text style={[styles.badgeText, isUrgent && styles.badgeTextUrgent]}>
                    剩余 {formatCountdown(remaining)}
                  </Text>
                </View>
              ) : (
                <View style={styles.permanentPill}>
                  <Text style={styles.permanentText}>永久保存</Text>
                </View>
              )}
            </View>
          </View>
          <View style={[styles.actionBtn, styles.headerPreviewBtn]}>
            <Ionicons name="eye-outline" size={15} color="#1890ff" />
            <Text style={[styles.actionBtnText, { color: '#1890ff' }]}>预览</Text>
          </View>
        </TouchableOpacity>

        {/* 底部操作行 */}
        <View style={styles.cardActionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleOpenUrl(item)}>
            <Ionicons name="download-outline" size={15} color="#2563eb" />
            <Text style={[styles.actionBtnText, { color: '#2563eb' }]}>打开/下载</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={() => handleCopyUrl(item)}>
            <Ionicons name="copy-outline" size={15} color="#475569" />
            <Text style={styles.actionBtnText}>复制直链</Text>
          </TouchableOpacity>

          {isTemp && (
            <TouchableOpacity style={styles.actionBtn} onPress={() => handlePromote(item)}>
              <Ionicons name="bookmark-outline" size={15} color="#d97706" />
              <Text style={[styles.actionBtnText, { color: '#d97706' }]}>转永久</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, styles.deleteBtn]}
            onPress={() => handleDelete(item)}
          >
            <Ionicons name="trash-outline" size={15} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // 面包屑导航片段
  const breadcrumbSegments = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/');
  }, [currentPath]);

  const isEmpty = viewData.folders.length === 0 && viewData.files.length === 0;

  return (
    <View style={styles.container}>
      {/* Web 端隐藏文件夹上传 input */}
      {Platform.OS === 'web' && (
        <input
          ref={webFolderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          // @ts-ignore
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleWebFolderInputChange}
        />
      )}

      {/* 顶部双分区切换 */}
      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, currentTab === 'temp' && styles.segmentBtnActive]}
          onPress={() => setCurrentTab('temp')}
        >
          <Text style={[styles.segmentText, currentTab === 'temp' && styles.segmentTextActive]}>
            临时文件 (10分钟)
          </Text>
          <View style={[styles.countBadge, currentTab === 'temp' && styles.countBadgeActive]}>
            <Text style={[styles.countText, currentTab === 'temp' && styles.countTextActive]}>
              {tempCount}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, currentTab === 'permanent' && styles.segmentBtnActive]}
          onPress={() => setCurrentTab('permanent')}
        >
          <Text style={[styles.segmentText, currentTab === 'permanent' && styles.segmentTextActive]}>
            永久文件
          </Text>
          <View style={[styles.countBadge, currentTab === 'permanent' && styles.countBadgeActive]}>
            <Text style={[styles.countText, currentTab === 'permanent' && styles.countTextActive]}>
              {permanentCount}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 规则说明条 */}
      <View style={styles.hintBar}>
        <Ionicons
          name={currentTab === 'temp' ? 'time-outline' : 'cloud-done-outline'}
          size={14}
          color="#64748b"
        />
        <Text style={styles.hintText}>
          {currentTab === 'temp'
            ? '临时文件在上传 10 分钟后自动彻底销毁，支持转为永久'
            : '永久文件安全存储，支持跨端无限制下载与查看'}
        </Text>
      </View>

      {/* 目录层级导航与面包屑栏 */}
      <View style={styles.breadcrumbBar}>
        {Boolean(currentPath) && (
          <TouchableOpacity style={styles.backBtn} onPress={handleGoBack} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={16} color="#2563eb" />
            <Text style={styles.backBtnText}>上一级</Text>
          </TouchableOpacity>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.breadcrumbContent}
        >
          <TouchableOpacity onPress={() => setCurrentPath('')} activeOpacity={0.7}>
            <Text style={[styles.breadcrumbText, !currentPath && styles.breadcrumbTextActive]}>
              全部文件
            </Text>
          </TouchableOpacity>

          {breadcrumbSegments.map((segment, index) => {
            const isLast = index === breadcrumbSegments.length - 1;
            const target = breadcrumbSegments.slice(0, index + 1).join('/');

            return (
              <React.Fragment key={target}>
                <Ionicons name="chevron-forward" size={13} color="#94a3b8" style={{ marginHorizontal: 4 }} />
                <TouchableOpacity
                  onPress={() => !isLast && setCurrentPath(target)}
                  activeOpacity={isLast ? 1 : 0.7}
                >
                  <Text style={[styles.breadcrumbText, isLast && styles.breadcrumbTextActive]}>
                    {segment}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </ScrollView>
      </View>

      {/* 文件及文件夹列表 */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1890ff" />
          <Text style={styles.loadingText}>加载暂存列表中...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadFiles(true)}
              tintColor="#1890ff"
            />
          }
        >
          {/* 渲染子文件夹 */}
          {viewData.folders.map(folder => renderFolderCard(folder))}

          {/* 渲染当前目录直属文件 */}
          {viewData.files.map(file => renderFileCard(file))}

          {/* 空白占位 */}
          {isEmpty && (
            <View style={styles.emptyContainer}>
              <Ionicons
                name={currentPath ? 'folder-open-outline' : 'cloud-upload-outline'}
                size={48}
                color="#cbd5e1"
              />
              <Text style={styles.emptyTitle}>
                {currentPath
                  ? `【${breadcrumbSegments[breadcrumbSegments.length - 1]}】目录为空`
                  : `暂无${currentTab === 'temp' ? '临时' : '永久'}文件`}
              </Text>
              <Text style={styles.emptySubtitle}>
                点击下方「上传文件」按钮，选择手机相册、系统文件或直接上传完整文件夹
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* 底部悬浮上传按钮 */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.uploadFab}
          onPress={() => setShowPickerSheet(true)}
          disabled={isUploading || isBatchUploading}
        >
          {isUploading || isBatchUploading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <Ionicons name="cloud-upload" size={18} color="#ffffff" style={{ marginRight: 6 }} />
              <Text style={styles.uploadFabText}>
                上传至【{currentTab === 'temp' ? '临时暂存' : '永久文件'}】
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* 上传来源选择抽屉 */}
      <Modal
        visible={showPickerSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPickerSheet(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPickerSheet(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>选择暂存文件来源 (单文件最高100MB)</Text>

            <TouchableOpacity style={styles.sheetOption} onPress={handlePickFromLibrary}>
              <View style={[styles.sheetIconBox, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="images-outline" size={22} color="#2563eb" />
              </View>
              <View style={styles.sheetOptionTextCol}>
                <Text style={styles.sheetOptionPrimary}>从手机相册选取</Text>
                <Text style={styles.sheetOptionSecondary}>支持图片、动图与高清视频</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOption} onPress={handlePickFromDocuments}>
              <View style={[styles.sheetIconBox, { backgroundColor: '#f0fdf4' }]}>
                <Ionicons name="document-text-outline" size={22} color="#16a34a" />
              </View>
              <View style={styles.sheetOptionTextCol}>
                <Text style={styles.sheetOptionPrimary}>选取单个系统文件</Text>
                <Text style={styles.sheetOptionSecondary}>支持 PDF、Word、Excel、压缩包等</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetOption} onPress={handlePickFolder}>
              <View style={[styles.sheetIconBox, { backgroundColor: '#fdf4ff' }]}>
                <Ionicons name="folder-open" size={22} color="#a855f7" />
              </View>
              <View style={styles.sheetOptionTextCol}>
                <Text style={styles.sheetOptionPrimary}>上传完整文件夹 (保留目录层级)</Text>
                <Text style={styles.sheetOptionSecondary}>
                  {Platform.OS === 'web'
                    ? '选择浏览器文件夹，自动扫描子目录及内部文件'
                    : '选取多个文件打包为目录，支持一键下载ZIP与层级浏览'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetCancelBtn}
              onPress={() => setShowPickerSheet(false)}
            >
              <Text style={styles.sheetCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 原生端文件夹名称确认弹窗 */}
      <Modal
        visible={showFolderNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFolderNameModal(false)}
      >
        <View style={styles.centerModalOverlay}>
          <View style={styles.folderModalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="folder" size={22} color="#f59e0b" />
              <Text style={styles.folderModalTitle}>创建并上传文件夹</Text>
            </View>
            <Text style={styles.folderModalDesc}>
              请输入要在云端暂存区归纳的文件夹名称，确认后选择要归入该文件夹的文件：
            </Text>

            <TextInput
              style={styles.folderModalInput}
              value={folderNameInput}
              onChangeText={setFolderNameInput}
              placeholder="例如：会议纪要资料、设计图集..."
              placeholderTextColor="#94a3b8"
              autoFocus
            />

            <View style={styles.folderModalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => setShowFolderNameModal(false)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirmBtn]}
                onPress={handleNativeFolderConfirm}
              >
                <Text style={styles.modalConfirmText}>下一步：选取文件</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 批量上传进度遮罩 */}
      <Modal visible={isBatchUploading} transparent animationType="fade">
        <View style={styles.centerModalOverlay}>
          <View style={styles.progressCard}>
            <ActivityIndicator size="large" color="#7c3aed" style={{ marginBottom: 14 }} />
            <Text style={styles.progressTitle}>
              正在批量上传 ({batchCurrentIndex} / {batchTotalCount})
            </Text>
            <Text style={styles.progressSub} numberOfLines={1}>
              {currentUploadingFileName}
            </Text>
            <Text style={styles.progressHint}>请保持网络连接，上传完成后将自动展示目录</Text>
          </View>
        </View>
      </Modal>

      {/* 沉浸式全屏文件即时预览模态框 */}
      <FilePreviewModal
        visible={Boolean(previewFile)}
        file={previewFile}
        onClose={() => setPreviewFile(null)}
        onPromote={handlePromote}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 8,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6,
    gap: 6,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748b',
  },
  segmentTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  countBadge: {
    backgroundColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countBadgeActive: {
    backgroundColor: '#eff6ff',
  },
  countText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  countTextActive: {
    color: '#2563eb',
  },
  hintBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  hintText: {
    fontSize: 12,
    color: '#64748b',
    flex: 1,
  },
  breadcrumbBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
    marginRight: 6,
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
    gap: 2,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
  },
  breadcrumbContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbText: {
    fontSize: 13,
    color: '#64748b',
  },
  breadcrumbTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  folderCard: {
    backgroundColor: '#fffdfa',
    borderColor: '#fde68a',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  folderIconBox: {
    backgroundColor: '#fef3c7',
  },
  cardMetaCol: {
    flex: 1,
    marginRight: 10,
  },
  headerPreviewBtn: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 4,
  },
  folderCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#b45309',
    marginBottom: 4,
    flex: 1,
  },
  cardSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardSize: {
    fontSize: 12,
    color: '#94a3b8',
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
  },
  badgeUrgent: {
    backgroundColor: '#fee2e2',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
  },
  badgeDotUrgent: {
    backgroundColor: '#ef4444',
  },
  badgeText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  badgeTextUrgent: {
    color: '#dc2626',
    fontWeight: '700',
  },
  permanentPill: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  permanentText: {
    fontSize: 11,
    color: '#059669',
    fontWeight: '600',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginTop: 12,
    paddingTop: 10,
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  deleteBtn: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#475569',
    marginTop: 12,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 18,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  uploadFab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  uploadFabText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingHorizontal: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 14,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  sheetIconBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  sheetOptionTextCol: {
    flex: 1,
  },
  sheetOptionPrimary: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  sheetOptionSecondary: {
    fontSize: 12,
    color: '#94a3b8',
  },
  sheetCancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  sheetCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#475569',
  },
  centerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  folderModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
  },
  folderModalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  folderModalDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 14,
  },
  folderModalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 16,
  },
  folderModalActions: {
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
    backgroundColor: '#2563eb',
  },
  modalConfirmText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  progressCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  progressSub: {
    fontSize: 13,
    color: '#7c3aed',
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  progressHint: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
  },
});
