import request, { getServerUrl } from './client';
import { ApiResponse, Note, Notebook, NoteHistoryItem } from './types';

// 获取笔记本列表
export const getNotebooks = (): Promise<ApiResponse<Notebook[]>> => {
  return request({
    url: '/notebooks',
    method: 'get',
  });
};

// 创建笔记本
export const createNotebook = (data: { title: string; parentId?: string | null }): Promise<ApiResponse<Notebook>> => {
  return request({
    url: '/notebooks',
    method: 'post',
    data,
  });
};

// 获取指定笔记本下的笔记列表
export const getNotebookNotes = (notebookId: string, params?: { search?: string }): Promise<ApiResponse<Note[]>> => {
  return request({
    url: `/notes/notebook/${notebookId}`,
    method: 'get',
    params,
  });
};

// 获取最近文档
export const getRecentNotes = (): Promise<ApiResponse<Note[]>> => {
  return request({
    url: '/notes/recent',
    method: 'get',
  });
};

// 获取已收藏的笔记列表
export const getStarredNotes = (): Promise<ApiResponse<Note[]>> => {
  return request({
    url: '/notes/starred',
    method: 'get',
  });
};

// 获取笔记详情
export const getNoteDetail = (noteId: string): Promise<ApiResponse<Note>> => {
  return request({
    url: `/notes/${noteId}`,
    method: 'get',
  });
};

// 创建笔记
export const createNote = (data: {
  title: string;
  content?: string;
  notebookId: string;
}): Promise<ApiResponse<Note>> => {
  return request({
    url: '/notes',
    method: 'post',
    data,
  });
};

// 更新笔记
export const updateNote = (noteId: string, data: { title?: string; content?: string }): Promise<ApiResponse<Note>> => {
  return request({
    url: `/notes/${noteId}`,
    method: 'put',
    data,
  });
};

// 更新笔记收藏状态
export const updateNoteStarred = (noteId: string, isStarred: boolean): Promise<ApiResponse<Note>> => {
  return request({
    url: `/notes/${noteId}/starred`,
    method: 'put',
    data: { isStarred },
  });
};

// 删除笔记
export const deleteNote = (noteId: string): Promise<ApiResponse<any>> => {
  return request({
    url: `/notes/${noteId}`,
    method: 'delete',
  });
};

// 移动端原生相册/拍照上传笔记插图
export const uploadNoteImage = async (fileUri: string): Promise<ApiResponse<{ url: string; filename: string }>> => {
  const formData = new FormData();
  const filename = fileUri.split('/').pop() || `mobile_img_${Date.now()}.jpg`;
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : 'image/jpeg';

  formData.append('image', {
    uri: fileUri,
    name: filename,
    type,
  } as any);

  return request({
    url: '/uploads/notes',
    method: 'post',
    data: formData,
    headers: {
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
