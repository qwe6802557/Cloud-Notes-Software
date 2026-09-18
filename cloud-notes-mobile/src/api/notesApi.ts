import { Platform } from 'react-native';
import request from './client';
import { ApiResponse, Note, Notebook, NoteHistoryItem } from './types';

// 获取笔记本列表
export const getNotebooks = async (): Promise<ApiResponse<Notebook[]>> => {
  const res: any = await request({
    url: '/notebooks',
    method: 'get',
  });
  const rawData = res?.data;
  const rawList: any[] = Array.isArray(rawData) ? rawData : (rawData?.notebooks || []);
  const list: Notebook[] = rawList.map(item => ({
    ...item,
    title: item.title || item.name || '未命名笔记本',
    name: item.name || item.title || '未命名笔记本',
  }));
  return { ...res, data: list };
};

// 创建笔记本
export const createNotebook = async (data: { title: string; parentId?: string | null; name?: string }): Promise<ApiResponse<Notebook>> => {
  const notebookName = data.name || data.title || '';
  const res: any = await request({
    url: '/notebooks',
    method: 'post',
    data: {
      ...data,
      name: notebookName,
      title: notebookName,
    },
  });
  const rawNb = res?.data?.notebook || res?.data;
  const normalizedNb = rawNb ? {
    ...rawNb,
    title: rawNb.title || rawNb.name || notebookName,
    name: rawNb.name || rawNb.title || notebookName,
  } : rawNb;
  return { ...res, data: normalizedNb };
};

// 获取指定笔记本下的笔记列表
export const getNotebookNotes = async (
  notebookId: string,
  params?: { search?: string; parentId?: string | null; all?: string }
): Promise<ApiResponse<Note[]>> => {
  const res: any = await request({
    url: `/notes/notebook/${notebookId}`,
    method: 'get',
    params,
  });
  const rawData = res?.data;
  const list = Array.isArray(rawData) ? rawData : (rawData?.notes || []);
  return { ...res, data: list };
};

// 获取最近文档
export const getRecentNotes = async (): Promise<ApiResponse<Note[]>> => {
  const res: any = await request({
    url: '/notes/recent',
    method: 'get',
  });
  const rawData = res?.data;
  const list = Array.isArray(rawData) ? rawData : (rawData?.notes || []);
  return { ...res, data: list };
};

// 获取已收藏的笔记列表
export const getStarredNotes = async (): Promise<ApiResponse<Note[]>> => {
  const res: any = await request({
    url: '/notes/starred',
    method: 'get',
  });
  const rawData = res?.data;
  const list = Array.isArray(rawData) ? rawData : (rawData?.notes || []);
  return { ...res, data: list };
};

// 获取笔记详情
export const getNoteDetail = async (noteId: string): Promise<ApiResponse<Note>> => {
  const res: any = await request({
    url: `/notes/${noteId}`,
    method: 'get',
  });
  return { ...res, data: res?.data?.note || res?.data };
};

// 创建笔记
export const createNote = async (data: {
  title: string;
  content?: string;
  notebookId: string;
  parentId?: string | null;
  type?: 'note' | 'folder';
}): Promise<ApiResponse<Note>> => {
  const res: any = await request({
    url: '/notes',
    method: 'post',
    data,
  });
  return { ...res, data: res?.data?.note || res?.data };
};

// 更新笔记
export const updateNote = async (noteId: string, data: { title?: string; content?: string }): Promise<ApiResponse<Note>> => {
  const res: any = await request({
    url: `/notes/${noteId}`,
    method: 'put',
    data,
  });
  return { ...res, data: res?.data?.note || res?.data };
};

// 更新笔记收藏状态
export const updateNoteStarred = async (noteId: string, isStarred: boolean): Promise<ApiResponse<Note>> => {
  const res: any = await request({
    url: `/notes/${noteId}/starred`,
    method: 'put',
    data: { isStarred },
  });
  return { ...res, data: res?.data?.note || res?.data };
};



// 删除笔记
export const deleteNote = (noteId: string): Promise<ApiResponse<any>> => {
  return request({
    url: `/notes/${noteId}`,
    method: 'delete',
  });
};

// 移动端/Web端相册或拍照上传笔记插图
export const uploadNoteImage = async (
  fileOrAsset: any
): Promise<ApiResponse<{ url: string; filename: string }>> => {
  const formData = new FormData();

  if (Platform.OS === 'web') {
    let fileToAppend: any = null;
    let filename = 'mobile_img.jpg';

    if (typeof fileOrAsset === 'string') {
      filename = fileOrAsset.split('/').pop()?.split('?')[0] || `img_${Date.now()}.jpg`;
      const res = await fetch(fileOrAsset);
      const blob = await res.blob();
      fileToAppend = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    } else if (fileOrAsset && fileOrAsset.file instanceof File) {
      fileToAppend = fileOrAsset.file;
      filename = fileOrAsset.fileName || fileOrAsset.file.name || `img_${Date.now()}.jpg`;
    } else if (fileOrAsset && fileOrAsset.uri) {
      filename = fileOrAsset.fileName || fileOrAsset.uri.split('/').pop()?.split('?')[0] || `img_${Date.now()}.jpg`;
      const res = await fetch(fileOrAsset.uri);
      const blob = await res.blob();
      const mime = fileOrAsset.mimeType || fileOrAsset.type || blob.type || 'image/jpeg';
      fileToAppend = new File([blob], filename, { type: mime });
    } else if (fileOrAsset instanceof Blob) {
      filename = (fileOrAsset as any).name || `img_${Date.now()}.jpg`;
      fileToAppend = fileOrAsset;
    }

    if (fileToAppend) {
      formData.append('image', fileToAppend, filename);
    }
  } else {
    const fileUri = typeof fileOrAsset === 'string' ? fileOrAsset : fileOrAsset.uri || '';
    const filename = (typeof fileOrAsset !== 'string' && fileOrAsset.fileName)
      ? fileOrAsset.fileName
      : (fileUri.split('/').pop()?.split('?')[0] || `mobile_img_${Date.now()}.jpg`);
    const match = /\.(\w+)$/.exec(filename);
    const type = (typeof fileOrAsset !== 'string' && (fileOrAsset.mimeType || fileOrAsset.type))
      ? (fileOrAsset.mimeType || fileOrAsset.type)
      : (match ? `image/${match[1]}` : 'image/jpeg');

    formData.append('image', {
      uri: fileUri,
      name: filename,
      type,
    } as any);
  }

  return request({
    url: '/uploads/notes',
    method: 'post',
    data: formData,
    headers: Platform.OS === 'web' ? undefined : {
      'Content-Type': 'multipart/form-data',
    },
  });
};

// 获取笔记历史版本列表
export const getNoteHistories = (noteId: string): Promise<ApiResponse<NoteHistoryItem[]>> => {
  return request({
    url: `/notes/${noteId}/histories`,
    method: 'get',
  });
};
