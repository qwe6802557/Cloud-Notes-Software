import { Platform } from 'react-native';
import request, { getServerUrl } from './client';
import { ApiResponse } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';

export interface RAGStats {
  totalNotes: number;
  indexedNotes: number;
  totalChunks: number;
  totalTokens: number;
  embeddingModel: string;
}

export interface CitationItem {
  citationIndex: number;
  noteId: string;
  noteTitle: string;
  notebookName?: string;
  headerPath?: string;
  snippet: string;
  similarity?: number;
}

export interface StreamRAGParams {
  question: string;
  scope?: {
    type?: 'all' | 'notebook' | 'note';
    notebookId?: string;
    noteId?: string;
  };
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface StreamRAGCallbacks {
  onMeta?: (meta: { citations: CitationItem[] }) => void;
  onDelta?: (delta: string, fullText: string) => void;
  onFinish?: (fullText: string) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * 获取当前知识库向量化统计数据
 */
export const getRAGStats = (): Promise<ApiResponse<RAGStats>> => {
  return request({
    url: '/ai/rag/stats',
    method: 'get',
  });
};

/**
 * 触发全库重新构建向量切片与索引
 */
export const triggerRAGReindex = (): Promise<ApiResponse<{ indexedNotes: number; totalChunks: number }>> => {
  return request({
    url: '/ai/rag/reindex',
    method: 'post',
  });
};

/**
 * 知识库混合检索
 */
export const searchRAGKnowledge = (query: string, scope?: StreamRAGParams['scope']): Promise<ApiResponse<CitationItem[]>> => {
  return request({
    url: '/ai/rag/search',
    method: 'post',
    data: { query, scope },
  });
};

/**
 * 跨平台知识库 SSE 流式问答（支持 Web 与 React Native 原生端）
 */
export const streamRAGChat = async (
  params: StreamRAGParams,
  { onMeta, onDelta, onFinish, onError, signal }: StreamRAGCallbacks
): Promise<string> => {
  const serverUrl = getServerUrl();
  const cleanBase = serverUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/api/ai/rag/chat`;
  const token = await AsyncStorage.getItem(Config.storageKeys.token);

  let fullText = '';

  // Web 端环境处理
  if (Platform.OS === 'web' && typeof fetch !== 'undefined') {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
        signal,
      });

      if (!response.ok) {
        let errorMsg = `知识库服务响应异常 (${response.status})`;
        try {
          const errData = await response.json();
          errorMsg = errData.message || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (!trimmed.startsWith('data:')) continue;
            const payloadStr = trimmed.replace(/^data:\s*/, '');
            if (payloadStr === '[DONE]') {
              onFinish?.(fullText);
              return fullText;
            }

            try {
              const data = JSON.parse(payloadStr);
              if (data.type === 'error') {
                throw new Error(data.error);
              }
              if (data.type === 'meta') {
                onMeta?.({ citations: data.citations || [] });
              }
              if (data.type === 'delta' && data.text) {
                fullText += data.text;
                onDelta?.(data.text, fullText);
              }
              if (data.type === 'done') {
                onFinish?.(fullText);
                return fullText;
              }
            } catch (pErr: any) {
              if (pErr.message && !pErr.message.includes('JSON')) {
                throw pErr;
              }
            }
          }
        }

        onFinish?.(fullText);
        return fullText;
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || (signal && signal.aborted)) {
        return fullText;
      }
      onError?.(err);
      throw err;
    }
  }

  // React Native 原生环境
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    let processedLength = 0;
    let buffer = '';

    const handleChunk = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.replace(/^data:\s*/, '');

        if (payloadStr === '[DONE]') {
          onFinish?.(fullText);
          resolve(fullText);
          return;
        }

        try {
          const data = JSON.parse(payloadStr);
          if (data.type === 'error') {
            const err = new Error(data.error);
            onError?.(err);
            reject(err);
            return;
          }
          if (data.type === 'meta') {
            onMeta?.({ citations: data.citations || [] });
          }
          if (data.type === 'delta' && data.text) {
            fullText += data.text;
            onDelta?.(data.text, fullText);
          }
          if (data.type === 'done') {
            onFinish?.(fullText);
            resolve(fullText);
            return;
          }
        } catch {}
      }
    };

    xhr.onprogress = () => {
      const responseText = xhr.responseText || '';
      if (responseText.length > processedLength) {
        const newChunk = responseText.slice(processedLength);
        processedLength = responseText.length;
        handleChunk(newChunk);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const responseText = xhr.responseText || '';
        if (responseText.length > processedLength) {
          handleChunk(responseText.slice(processedLength));
        }
        onFinish?.(fullText);
        resolve(fullText);
      } else {
        let msg = `知识库服务响应异常 (${xhr.status})`;
        try {
          const resJson = JSON.parse(xhr.responseText);
          msg = resJson.message || msg;
        } catch {}
        const err = new Error(msg);
        onError?.(err);
        reject(err);
      }
    };

    xhr.onerror = () => {
      const err = new Error('网络连接异常，无法连接到知识库服务');
      onError?.(err);
      reject(err);
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        resolve(fullText);
      });
    }

    xhr.send(JSON.stringify(params));
  });
};
