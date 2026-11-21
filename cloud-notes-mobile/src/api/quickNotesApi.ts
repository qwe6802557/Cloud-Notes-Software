import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';
import request, { getServerUrl } from './client';
import { ApiResponse, Note } from './types';

export type QuickMemoKind = 'text' | 'link' | 'image' | 'file';
export type QuickMemoStorageType = 'temp' | 'permanent';

export interface QuickMemoLink {
  url: string;
  host?: string;
}

export interface QuickMemoAttachment {
  filename: string;
  originalName: string;
  relativePath?: string;
  folderName?: string;
  size: number;
  mimetype: string;
  url: string;
}

export interface QuickMemoItem {
  _id: string;
  id: string;
  kind: QuickMemoKind;
  content: string;
  links: QuickMemoLink[];
  attachment: QuickMemoAttachment | null;
  storageType: QuickMemoStorageType;
  expireAt: string | null;
  remainingSeconds: number | null;
  convertedNoteId: string | null;
  legacySource?: 'stash';
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QuickMemoCounts {
  all: number;
  temp: number;
  permanent: number;
}

export interface QuickMemoQuota {
  permanentUsedBytes: number;
  permanentLimitBytes: number;
}

export interface QuickMemoCursor {
  since: string;
  cursorId: string;
}

export interface QuickMemoListResponse {
  items: QuickMemoItem[];
  counts: QuickMemoCounts;
  quota: QuickMemoQuota;
  serverTime: string;
  nextCursor: QuickMemoCursor | null;
}

export interface QuickMemoDeltaResponse {
  items: QuickMemoItem[];
  legacyItems?: QuickMemoItem[];
  counts: QuickMemoCounts;
  quota: QuickMemoQuota;
  serverTime: string;
  nextCursor: QuickMemoCursor | null;
  hasMore: boolean;
}

export interface ConvertQuickMemoResult {
  note: Note;
  memo: QuickMemoItem;
}

/**
 * 将相对资源路径补全为当前激活节点的绝对 URL
 */
export function resolveQuickMemoUrl(rawUrl?: string | null): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = getServerUrl().replace(/\/+$/, '');
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${base}${path}`;
}

export const getQuickNotes = (params?: {
  type?: QuickMemoStorageType;
  kind?: QuickMemoKind;
  limit?: number;
}): Promise<ApiResponse<QuickMemoListResponse>> => {
  return request({
    url: '/quick-notes',
    method: 'get',
    params: params || {},
  });
};

export const deltaQuickNotes = (params: {
  since: string;
  cursorId?: string;
  limit?: number;
}): Promise<ApiResponse<QuickMemoDeltaResponse>> => {
  return request({
    url: '/quick-notes/delta',
    method: 'get',
    params,
  });
};

export const createQuickText = (data: {
  content: string;
  storageType?: QuickMemoStorageType;
  ttlMinutes?: number;
  clientId?: string;
}): Promise<ApiResponse<QuickMemoItem>> => {
  return request({
    url: '/quick-notes/text',
    method: 'post',
    data,
  });
};

export const uploadQuickFile = async (
  fileData: {
    uri: string;
    name?: string;
    type?: string;
    size?: number;
    file?: any;
    relativePath?: string;
    folderName?: string;
    originalName?: string;
  },
  options: {
    storageType?: QuickMemoStorageType;
    ttlMinutes?: number;
    batchExpireAt?: string;
    content?: string;
    clientId?: string;
  } = {}
): Promise<ApiResponse<QuickMemoItem>> => {
  const formData = new FormData();
  const storageType = options.storageType || 'temp';
  formData.append('storageType', storageType);

  if (options.ttlMinutes !== undefined) {
    formData.append('ttlMinutes', String(options.ttlMinutes));
  }
  if (options.batchExpireAt) {
    formData.append('batchExpireAt', options.batchExpireAt);
  }
  if (options.content) {
    formData.append('content', options.content);
  }
  if (options.clientId) {
    formData.append('clientId', options.clientId);
  }
  if (fileData.relativePath) {
    formData.append('relativePath', fileData.relativePath);
  }
  if (fileData.folderName) {
    formData.append('folderName', fileData.folderName);
  }

  const resolvedName = fileData.originalName || fileData.name || `memo_${Date.now()}`;
  formData.append('originalName', resolvedName);

  if (Platform.OS === 'web') {
    if (fileData.file) {
      formData.append('file', fileData.file);
    } else {
      const response = await fetch(fileData.uri);
      const blob = await response.blob();
      formData.append('file', blob, resolvedName);
    }
  } else {
    formData.append('file', {
      uri: fileData.uri,
      name: resolvedName,
      type: fileData.type || 'application/octet-stream',
    } as any);
  }

  return request({
    url: '/quick-notes/upload',
    method: 'post',
    data: formData,
    headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
  });
};

export const promoteQuickMemo = (id: string): Promise<ApiResponse<QuickMemoItem>> => {
  return request({
    url: `/quick-notes/${id}/promote`,
    method: 'post',
  });
};

export const extendQuickMemo = (id: string): Promise<ApiResponse<QuickMemoItem>> => {
  return request({
    url: `/quick-notes/${id}/extend`,
    method: 'post',
  });
};

export const deleteQuickMemo = (id: string): Promise<ApiResponse<{ id: string }>> => {
  return request({
    url: `/quick-notes/${id}`,
    method: 'delete',
  });
};

export const convertQuickMemoToNote = (
  id: string,
  data: { notebookId?: string; title?: string }
): Promise<ApiResponse<ConvertQuickMemoResult>> => {
  return request({
    url: `/quick-notes/${id}/to-note`,
    method: 'post',
    data,
  });
};

export const promoteQuickFolder = (folderName: string): Promise<ApiResponse<any>> => {
  return request({
    url: '/quick-notes/folder/promote',
    method: 'post',
    data: { folderName },
  });
};

export const deleteQuickFolder = (
  folderName: string,
  storageType: QuickMemoStorageType
): Promise<ApiResponse<any>> => {
  return request({
    url: '/quick-notes/folder',
    method: 'delete',
    data: { folderName, storageType },
  });
};

export const getQuickFolderDownloadUrl = async (
  folderName: string,
  storageType: QuickMemoStorageType
): Promise<string> => {
  const base = getServerUrl().replace(/\/+$/, '');
  const token = await AsyncStorage.getItem(Config.storageKeys.token);
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${base}/api/quick-notes/folder/download?folderName=${encodeURIComponent(folderName)}&storageType=${storageType}${tokenParam}`;
};
