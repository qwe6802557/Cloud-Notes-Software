export interface User {
  _id: string;
  username: string;
  email: string;
  avatar?: string;
  role?: string;
  createdAt?: string;
}

export interface Notebook {
  _id: string;
  title: string;
  name?: string;
  parentId?: string | null;
  userId?: string;
  icon?: string;
  color?: string;
  children?: Notebook[];
  noteCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface Note {
  _id: string;
  title: string;
  content: string;
  notebookId: string;
  userId: string;
  type?: 'note' | 'folder';
  parentId?: string | null;
  isStarred?: boolean;
  isDeleted?: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteHistoryItem {
  _id: string;
  noteId: string;
  title: string;
  content: string;
  version: number;
  trigger: string;
  wordCount?: number;
  charCount?: number;
  createdAt: string;
}

export interface CaptchaData {
  svg: string;
  captchaKey: string;
}

export interface LoginResponseData {
  user: User;
  token: string;
}

export interface ApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
}
