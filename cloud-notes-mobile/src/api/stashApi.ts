import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';
import request, { getServerUrl } from './client';
import { ApiResponse } from './types';

export interface StashFile {
  _id: string;
  id?: string;
  userId: string;
  filename: string;
  originalName: string;
  size: number;
  mimetype: string;
  storageType: 'temp' | 'permanent';
  expireAt: string | null;
  url: string;
  createdAt: string;
  updatedAt: string;
  remainingSeconds: number | null;
  relativePath?: string;
  folderName?: string;
  isFolder?: boolean;
}

export interface StashListResponse {
  files: StashFile[];
  tempCount: number;
  permanentCount: number;
}

// 获取暂存文件列表
export const getStashFiles = (type?: 'temp' | 'permanent'): Promise<ApiResponse<StashListResponse>> => {
  return request({
    url: '/stash',
    method: 'get',
    params: type ? { type } : {},
  });
};

// 移动端上传暂存文件（支持相册 Asset、系统 Document、以及文件夹子文件）
export const uploadStashFile = async (
  fileData: {
    uri: string;
    name?: string;
    type?: string;
    size?: number;
    file?: any;
    relativePath?: string;
    folderName?: string;
  },
  storageType: 'temp' | 'permanent' = 'temp',
  batchExpireAt?: string
): Promise<ApiResponse<StashFile>> => {
  const formData = new FormData();
  formData.append('storageType', storageType);

  if (fileData.relativePath) {
    formData.append('relativePath', fileData.relativePath);
  }
  if (fileData.folderName) {
    formData.append('folderName', fileData.folderName);
  }
  if (batchExpireAt) {
    formData.append('batchExpireAt', batchExpireAt);
  }

  if (Platform.OS === 'web') {
    if (fileData.file) {
      formData.append('file', fileData.file);
    } else {
      const response = await fetch(fileData.uri);
      const blob = await response.blob();
      formData.append('file', blob, fileData.name || 'stash_upload');
    }
  } else {
    formData.append('file', {
      uri: fileData.uri,
      name: fileData.name || `stash_${Date.now()}`,
      type: fileData.type || 'application/octet-stream',
    } as any);
  }

  return request({
    url: '/stash/upload',
    method: 'post',
    data: formData,
    headers: Platform.OS === 'web' ? undefined : {
      'Content-Type': 'multipart/form-data',
    },
  });
};

// 临时转永久
export const promoteStashFile = (id: string): Promise<ApiResponse<StashFile>> => {
  return request({
    url: `/stash/${id}/promote`,
    method: 'post',
  });
};

// 删除暂存文件
export const deleteStashFile = (id: string): Promise<ApiResponse<{ id: string }>> => {
  return request({
    url: `/stash/${id}`,
    method: 'delete',
  });
};

// 临时文件夹一键转为永久保存
export const promoteStashFolder = (folderName: string): Promise<ApiResponse<any>> => {
  return request({
    url: '/stash/folder/promote',
    method: 'post',
    data: { folderName },
  });
};

// 彻底删除整个文件夹
export const deleteStashFolder = (
  folderName: string,
  storageType: 'temp' | 'permanent'
): Promise<ApiResponse<any>> => {
  return request({
    url: '/stash/folder',
    method: 'delete',
    data: { folderName, storageType },
  });
};

// 获取打包下载文件夹的完整直链 (ZIP)
export const getFolderDownloadUrl = async (
  folderName: string,
  storageType: 'temp' | 'permanent'
): Promise<string> => {
  const base = getServerUrl().replace(/\/+$/, '');
  const token = await AsyncStorage.getItem(Config.storageKeys.token);
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${base}/api/stash/folder/download?folderName=${encodeURIComponent(folderName)}&storageType=${storageType}${tokenParam}`;
};
