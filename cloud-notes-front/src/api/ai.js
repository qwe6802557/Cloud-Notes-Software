import request from '@/utils/request';
import { getToken } from '@/utils/auth';

/**
 * 获取当前用户的 AI 配置
 */
export const getAIConfig = () => {
    return request({
        url: '/ai/config',
        method: 'get'
    });
};

/**
 * 更新用户个人自定义 AI 模型配置
 */
export const updateAIConfig = data => {
    return request({
        url: '/ai/config',
        method: 'put',
        data
    });
};

/**
 * 测试 AI 端点连通性
 */
export const testAIConnection = data => {
    return request({
        url: '/ai/test-connection',
        method: 'post',
        data
    });
};

/**
 * SSE 打字机流式输出请求封装
 * @param {object} params { action, text, noteTitle, customPrompt }
 * @param {object} callbacks { onDelta, onFinish, onError, signal }
 */
export const streamAICall = async (params, { onDelta, onFinish, onError, signal }) => {
    const apiBase = process.env.REACT_APP_API_URL || '/api';
    const cleanBase = apiBase.replace(/\/+$/, '');
    const url = `${cleanBase}/ai/stream`;
    const token = getToken();

    let fullText = '';

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(params),
            signal
        });

        if (!response.ok) {
            let errorMsg = `AI 服务响应异常 (${response.status})`;
            try {
                const errData = await response.json();
                errorMsg = errData.message || errorMsg;
            } catch {
                // fallback
            }
            throw new Error(errorMsg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const payloadStr = trimmed.replace(/^data:\s*/, '');
                try {
                    const data = JSON.parse(payloadStr);
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    if (data.delta) {
                        fullText += data.delta;
                        if (typeof onDelta === 'function') {
                            onDelta(data.delta, fullText);
                        }
                    }
                    if (data.done) {
                        if (typeof onFinish === 'function') {
                            onFinish(fullText);
                        }
                        return fullText;
                    }
                } catch (parseErr) {
                    if (payloadStr === '[DONE]') {
                        if (typeof onFinish === 'function') {
                            onFinish(fullText);
                        }
                        return fullText;
                    }
                }
            }
        }

        if (typeof onFinish === 'function') {
            onFinish(fullText);
        }
        return fullText;
    } catch (err) {
        if (err.name === 'AbortError') {
            return fullText;
        }
        if (typeof onError === 'function') {
            onError(err);
        } else {
            console.error('[StreamAI] 错误:', err);
        }
        throw err;
    }
};
