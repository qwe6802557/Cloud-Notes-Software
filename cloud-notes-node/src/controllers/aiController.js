const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const {
    resolveAIConfig,
    buildMessages,
    testEndpointConnection
} = require('../services/aiService');

/**
 * 核心 SSE 流式大模型输出接口
 */
exports.streamAI = asyncHandler(async (req, res) => {
    const { action = 'polish', text, noteTitle = '', customPrompt = '' } = req.body;

    if (!text && !customPrompt) {
        throw new AppError('请输入需要处理的文本或指令', 400);
    }

    const aiConfig = resolveAIConfig(req.user);
    if (!aiConfig.apiKey || !aiConfig.baseUrl) {
        throw new AppError('AI 引擎配置未就绪，请联系管理员或在设置中配置个人 API Key', 500);
    }

    const messages = buildMessages({ action, text, noteTitle, customPrompt });
    const endpoint = `${aiConfig.baseUrl}/chat/completions`;

    // 禁用 Nginx 缓冲与开启 SSE 推流响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    // 启动保活心跳（每 10 秒向客户端发送一次 SSE 注释），重置反向代理（Nginx / CDN）的空闲超时计数器
    const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': keep-alive\n\n');
            if (typeof res.flush === 'function') {
                res.flush();
            }
        }
    }, 10000);

    const cleanup = () => {
        clearInterval(heartbeatTimer);
    };

    // 支持客户端中断时取消上游大模型请求
    const abortController = new AbortController();
    req.on('close', () => {
        cleanup();
        abortController.abort();
    });

    try {
        const upstreamResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model,
                messages,
                stream: true,
                temperature: 0.7
            }),
            signal: abortController.signal
        });

        if (!upstreamResponse.ok) {
            cleanup();
            const errBody = await upstreamResponse.text();
            let errMsg = `上游模型响应异常 (HTTP ${upstreamResponse.status})`;
            try {
                const parsed = JSON.parse(errBody);
                errMsg = parsed?.error?.message || errMsg;
            } catch {
                errMsg = errBody.slice(0, 150) || errMsg;
            }

            res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
        }

        const reader = upstreamResponse.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // 保留未完整的末尾行

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const payload = trimmed.replace(/^data:\s*/, '');
                if (payload === '[DONE]') {
                    cleanup();
                    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                    res.end();
                    return;
                }

                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
                        if (typeof res.flush === 'function') {
                            res.flush();
                        }
                    }
                } catch {
                    // 忽略单个非 JSON 帧
                }
            }
        }

        // 处理最后残留的 buffer
        if (buffer.trim().startsWith('data:')) {
            const payload = buffer.trim().replace(/^data:\s*/, '');
            if (payload === '[DONE]') {
                cleanup();
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            } else {
                try {
                    const parsed = JSON.parse(payload);
                    const delta = parsed.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
                        if (typeof res.flush === 'function') {
                            res.flush();
                        }
                    }
                } catch {}
            }
        }

        cleanup();
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    } catch (err) {
        cleanup();
        const isAbort = err.name === 'AbortError' || err.cause?.name === 'AbortError';
        if (isAbort) {
            return;
        }
        console.error('[AIStream] 流式推流异常:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ code: 500, message: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: err.message, done: true })}\n\n`);
            res.end();
        }
    } finally {
        cleanup();
    }
});

/**
 * 获取当前用户的 AI 配置概要（不暴露系统预置默认凭据）
 */
exports.getAIConfig = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user._id).select('+aiConfig');
    const userConfig = user?.aiConfig || {};

    let maskedKey = '';
    if (userConfig.apiKey) {
        const k = userConfig.apiKey;
        maskedKey = k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '••••••••';
    }

    res.status(200).json({
        code: 200,
        message: '获取 AI 配置成功',
        data: {
            enabled: Boolean(userConfig.enabled),
            baseUrl: userConfig.baseUrl || '',
            apiKey: maskedKey,
            hasCustomKey: Boolean(userConfig.apiKey),
            model: userConfig.model || '',
            defaultModel: 'grok-chat-fast',
            systemModel: userConfig.systemModel || 'grok-chat-fast'
        }
    });
});

/**
 * 更新用户个人自定义 AI 模型配置
 */
exports.updateAIConfig = asyncHandler(async (req, res) => {
    const { enabled, baseUrl = '', apiKey = '', model = '', systemModel = '' } = req.body;
    const user = await User.findById(req.user._id).select('+aiConfig');

    if (!user) {
        throw new AppError('用户不存在', 404);
    }

    if (!user.aiConfig) {
        user.aiConfig = {};
    }

    if (enabled !== undefined) {
        user.aiConfig.enabled = Boolean(enabled);
    }
    user.aiConfig.baseUrl = (baseUrl || '').trim();
    user.aiConfig.model = (model || '').trim();
    if (systemModel) {
        user.aiConfig.systemModel = systemModel.trim();
    }

    // 只有提供了非掩码的新 Key 时才覆盖原有 Key
    if (apiKey && !apiKey.includes('••••')) {
        user.aiConfig.apiKey = apiKey.trim();
    }

    await user.save();

    let maskedKey = '';
    if (user.aiConfig.apiKey) {
        const k = user.aiConfig.apiKey;
        maskedKey = k.length > 8 ? `${k.slice(0, 4)}••••••••${k.slice(-4)}` : '••••••••';
    }

    res.status(200).json({
        code: 200,
        message: 'AI 模型配置保存成功',
        data: {
            enabled: user.aiConfig.enabled,
            baseUrl: user.aiConfig.baseUrl,
            apiKey: maskedKey,
            hasCustomKey: Boolean(user.aiConfig.apiKey),
            model: user.aiConfig.model,
            systemModel: user.aiConfig.systemModel || 'grok-chat-fast'
        }
    });
});

/**
 * 连通性自测
 */
exports.testConnection = asyncHandler(async (req, res) => {
    let { baseUrl, apiKey, model } = req.body;

    // 若 apiKey 为掩码或空，尝试回退使用当前数据库中已保存的个人 key
    if ((!apiKey || apiKey.includes('••••')) && req.user._id) {
        const user = await User.findById(req.user._id).select('+aiConfig');
        if (user?.aiConfig?.apiKey) {
            apiKey = user.aiConfig.apiKey;
        }
    }

    // 若依然无 Key，则测试系统内置默认连接
    if (!apiKey) {
        const defaultCfg = resolveAIConfig(req.user);
        baseUrl = baseUrl || defaultCfg.baseUrl;
        apiKey = defaultCfg.apiKey;
        model = model || defaultCfg.model;
    }

    const testRes = await testEndpointConnection({ baseUrl, apiKey, model });

    res.status(200).json({
        code: 200,
        message: `连通性测试成功 (耗时: ${testRes.latencyMs}ms)`,
        data: testRes
    });
});
