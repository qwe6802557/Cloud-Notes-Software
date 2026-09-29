import { Platform } from 'react-native';
import request from './client';
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

// 移动端上传暂存文件（支持相册 Asset 与系统 Document）
export const uploadStashFile = async (
  fileData: { uri: string; name?: string; type?: string; size?: number; file?: any },
  storageType: 'temp' | 'permanent' = 'temp'
): Promise<ApiResponse<StashFile>> => {
  const formData = new FormData();
  formData.append('storageType', storageType);

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
