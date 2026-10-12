const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { searchHybridKnowledge } = require('../services/hybridSearchService');
const { getIndexStats, reindexAllNotes } = require('../services/ragIndexService');
const { resolveAIConfig } = require('../services/aiService');
const {
    getRelatedNotesForNote,
    getSemanticGraphEdges,
    invalidateUserSemanticCache
} = require('../services/semanticRelationService');

/**
 * 获取用户当前知识库索引统计
 */
exports.getStats = asyncHandler(async (req, res) => {
    const stats = await getIndexStats(req.user._id);
    res.status(200).json({
        code: 200,
        message: '获取知识库统计成功',
        data: stats
    });
});

/**
 * 触发全库笔记构建或重新生成向量索引
 */
exports.reindex = asyncHandler(async (req, res) => {
    const result = await reindexAllNotes(req.user);
    invalidateUserSemanticCache(req.user._id);
    res.status(200).json({
        code: 200,
        message: '知识库全量索引构建完成',
        data: result
    });
});

/**
 * 知识库检索探活与测试
 */
exports.search = asyncHandler(async (req, res) => {
    const { query, scope } = req.body;
    if (!query) {
        throw new AppError('搜索内容不能为空', 400);
    }
    const citations = await searchHybridKnowledge({
        query,
        user: req.user,
        scope: scope || {}
    });
    res.status(200).json({
        code: 200,
        message: '检索成功',
        data: { citations }
    });
});

/**
 * 核心：知识库 RAG 流式问答 SSE 接口
 */
exports.streamChat = asyncHandler(async (req, res) => {
    const { question, scope = {}, history = [] } = req.body;

    if (!question || !question.trim()) {
        throw new AppError('提问内容不能为空', 400);
    }

    const aiConfig = resolveAIConfig(req.user);
    if (!aiConfig.apiKey || !aiConfig.baseUrl) {
        throw new AppError('AI 引擎配置未就绪，请联系管理员或在设置中配置个人 API Key', 500);
    }

    // 执行双路混合召回与 RRF 融合重排
    const citations = await searchHybridKnowledge({
        query: question,
        user: req.user,
        scope
    });

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    // 优先推送第一帧：证据链与来源切片元数据
    const metaPayload = {
        type: 'meta',
        citations: citations.map(c => ({
            citationIndex: c.citationIndex,
            noteId: c.noteId,
            noteTitle: c.noteTitle,
            notebookName: c.notebookName,
            headerPath: c.headerPath,
            snippet: c.content.slice(0, 160),
            similarity: c.similarity
        }))
    };
    res.write(`data: ${JSON.stringify(metaPayload)}\n\n`);

    const heartbeatTimer = setInterval(() => {
        if (!res.writableEnded) {
            res.write(': keep-alive\n\n');
        }
    }, 10000);

    const abortController = new AbortController();
    req.on('close', () => {
        clearInterval(heartbeatTimer);
        abortController.abort();
    });

    // 编排 RAG 提示词上下文
    const contextText = citations.length > 0
        ? citations
              .map(
                  c =>
                      `[来源 ${c.citationIndex}] 笔记标题：《${c.noteTitle}》 | 路径：${c.headerPath}\n${c.content}`
              )
              .join('\n\n---\n\n')
        : '（未检索到直接相关的个人笔记片段）';

    const systemPrompt = `你是一名严谨、博学且专注的「个人知识库问答助理」。
你的任务是根据下方提供的【用户笔记参考资料】如实回答用户的问题。

规则：
1. 请优先依据参考资料中的事实进行回答，条理清晰、层次分明、使用规范的 Markdown 格式；
2. 当在回答中引用了某个资料片段的观点、事实或数据时，请在对应句子末尾标注角标引用（如 [1]、[2]）；
3. 若提供的参考资料中包含答案，请直接给出专业解答；若参考资料中完全没有提及该问题，请诚实说明“在您的个人笔记中暂未找到相关记录”，并可结合通用知识给出合理建议；
4. 语言风格严谨精练，严禁泛泛而谈的废话。

【用户笔记参考资料】：
${contextText}`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-6).map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: question.trim() }
    ];

    const endpoint = `${aiConfig.baseUrl}/chat/completions`;

    try {
        const upstreamResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${aiConfig.apiKey}`
            },
            body: JSON.stringify({
                model: aiConfig.model,
                messages,
                stream: true,
                temperature: 0.3
            }),
            signal: abortController.signal
        });

        if (!upstreamResponse.ok) {
            const errorText = await upstreamResponse.text();
            res.write(`data: ${JSON.stringify({ type: 'error', error: `大模型服务异常: ${errorText.slice(0, 150)}` })}\n\n`);
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
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':')) continue;

                if (trimmed.startsWith('data: ')) {
                    const dataStr = trimmed.slice(6).trim();
                    if (dataStr === '[DONE]') {
                        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(dataStr);
                        const deltaContent = parsed.choices?.[0]?.delta?.content || '';
                        if (deltaContent) {
                            res.write(`data: ${JSON.stringify({ type: 'delta', text: deltaContent })}\n\n`);
                        }
                    } catch {}
                }
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message || '问答生成异常中断' })}\n\n`);
            res.end();
        }
    } finally {
        clearInterval(heartbeatTimer);
    }
});

/**
 * 针对单篇笔记获取语义关联最相近的推荐笔记列表
 */
exports.getRelatedNotes = asyncHandler(async (req, res) => {
    const { noteId } = req.params;
    const topK = parseInt(req.query.topK, 10) || 5;
    const minScore = parseFloat(req.query.minScore) || 0.55;

    if (!noteId) {
        throw new AppError('笔记ID不能为空', 400);
    }

    const list = await getRelatedNotesForNote({
        noteId,
        user: req.user,
        topK,
        minScore
    });

    res.status(200).json({
        code: 200,
        message: '获取语义关联笔记成功',
        data: list
    });
});

/**
 * 提取全库笔记间的语义关联边（供知识图谱星系模式渲染）
 */
exports.getSemanticGraph = asyncHandler(async (req, res) => {
    const threshold = parseFloat(req.query.threshold) || 0.65;
    const edges = await getSemanticGraphEdges({
        user: req.user,
        threshold
    });

    res.status(200).json({
        code: 200,
        message: '获取图谱语义连线成功',
        data: edges
    });
});

