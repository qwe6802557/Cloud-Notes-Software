import { Platform } from 'react-native';
import request, { getServerUrl } from './client';
import { ApiResponse } from './types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../constants/Config';

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface StreamAIParams {
  action: string;
  text?: string;
  noteTitle?: string;
  customPrompt?: string;
}

export interface StreamAICallbacks {
  onDelta?: (delta: string, fullText: string) => void;
  onFinish?: (fullText: string) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * 获取当前用户的自定义 AI 配置
 */
export const getAIConfig = (): Promise<ApiResponse<AIConfig>> => {
  return request({
    url: '/ai/config',
    method: 'get',
  });
};

/**
 * 更新用户个人自定义 AI 模型配置
 */
export const updateAIConfig = (data: Partial<AIConfig>): Promise<ApiResponse<any>> => {
  return request({
    url: '/ai/config',
    method: 'put',
    data,
  });
};

/**
 * 测试 AI 端点连通性
 */
export const testAIConnection = (data: Partial<AIConfig>): Promise<ApiResponse<{ message: string; reply?: string }>> => {
  return request({
    url: '/ai/test-connection',
    method: 'post',
    data,
  });
};

/**
 * 跨平台打字机流式 SSE 请求（支持 Web 与 React Native 原生环境）
 */
export const streamAICall = async (
  params: StreamAIParams,
  { onDelta, onFinish, onError, signal }: StreamAICallbacks
): Promise<string> => {
  const serverUrl = getServerUrl();
  const cleanBase = serverUrl.replace(/\/+$/, '');
  const url = `${cleanBase}/api/ai/stream`;
  const token = await AsyncStorage.getItem(Config.storageKeys.token);

  let fullText = '';

  // Web 环境优先使用 Fetch + ReadableStream
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
        let errorMsg = `AI 服务响应异常 (${response.status})`;
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
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const payloadStr = trimmed.replace(/^data:\s*/, '');
            try {
              const data = JSON.parse(payloadStr);
              if (data.error) throw new Error(data.error);
              if (data.delta) {
                fullText += data.delta;
                onDelta?.(data.delta, fullText);
              }
              if (data.done) {
                onFinish?.(fullText);
                return fullText;
              }
            } catch (pErr: any) {
              if (payloadStr === '[DONE]') {
                onFinish?.(fullText);
                return fullText;
              }
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

  // React Native 原生移动端通过 XMLHttpRequest onprogress 实现流式接收
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
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.replace(/^data:\s*/, '');
        try {
          const data = JSON.parse(payloadStr);
          if (data.error) {
            const err = new Error(data.error);
            onError?.(err);
            reject(err);
            return;
          }
          if (data.delta) {
            fullText += data.delta;
            onDelta?.(data.delta, fullText);
          }
          if (data.done) {
            onFinish?.(fullText);
            resolve(fullText);
            return;
          }
        } catch (pErr: any) {
          if (payloadStr === '[DONE]') {
            onFinish?.(fullText);
            resolve(fullText);
            return;
          }
        }
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
        let msg = `AI 服务响应异常 (${xhr.status})`;
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
      const err = new Error('网络请求异常，无法连接到 AI 服务');
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
