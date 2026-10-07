const config = require('../config');

/**
 * 解析用户生效的 AI 配置（双轨制：用户自定义优先，未开启则安全回退到系统内置自建模型）
 * 注意：系统内置的 defaultApiKey 与 defaultBaseUrl 绝不在前端或接口中明文暴露
 */
const resolveAIConfig = user => {
    if (user?.aiConfig?.enabled && user?.aiConfig?.apiKey && user?.aiConfig?.baseUrl) {
        return {
            apiKey: user.aiConfig.apiKey.trim(),
            baseUrl: user.aiConfig.baseUrl.trim().replace(/\/+$/, ''),
            model: (user.aiConfig.model || 'deepseek-chat').trim(),
            isCustom: true
        };
    }

    const selectedSystemModel = (user?.aiConfig?.systemModel || '').trim();
    return {
        apiKey: config.ai.defaultApiKey,
        baseUrl: config.ai.defaultBaseUrl.replace(/\/+$/, ''),
        model: selectedSystemModel || config.ai.defaultModel || 'grok-chat-fast',
        isCustom: false
    };
};

/**
 * 针对不同 AI 动作编排专业的 System Prompts
 */
const getSystemPrompt = (action, customPrompt = '') => {
    switch (action) {
        case 'polish':
            return '你是一名顶级文字主编与写作润色专家。请在保持原文核心语义、专业术语与Markdown排版格式不变的前提下，对用户输入的文本进行语言流畅度、表达精炼度与行文专业度优化。直接输出润色后的内容，严禁附加任何客套话、寒暄、解释或前言后语。';
        case 'continue':
            return '你是一名写作专家。请根据用户提供的上下文逻辑与写作风格，紧密承接上文继续自然地往下书写内容。直接输出续写内容，严禁输出任何多余的客套寒暄。';
        case 'expand':
            return '你是一名文字创作专家。请对用户提供的内容进行深度细节充实、论据丰富与逻辑阐述拓展。保持行文自然，直接输出扩充后的内容，不要输出前后多余的寒暄与废话。';
        case 'summarize_text':
            return '请用最简练精要的语言将用户输入的文本压缩提炼为核心结论，剔除冗余修饰，保留关键信息。直接输出精简结果。';
        case 'grammar':
            return '你是一名专业校对专家。请纠正用户输入文本中的所有错别字、语病与标点误用，直接输出修正后的纯净文本，禁止输出多余说明。';
        case 'translate_en':
            return '请将用户输入的文本精准地翻译为地道、专业的英文。直接输出英文翻译结果，不附加额外解释。';
        case 'translate_zh':
            return '请将用户输入的文本精准地翻译为地道流畅的中文。直接输出中文翻译结果，不附加额外解释。';
        case 'full_summary':
            return '请为整篇文档撰写一份结构清晰的高质量执行摘要。包含【核心要旨】与【关键要点清单】。以优雅规范的Markdown格式输出。';
        case 'extract_todos':
            return '请深度分析用户输入的笔记正文，自动识别其中蕴含的所有行动项、待办事项与任务分工。以标准Markdown待办清单（- [ ] 任务项）格式输出，按优先级从高到低排列。直接输出任务清单。';
        case 'mindmap_outline':
            return '请根据用户输入的文章内容，提取出结构化的大纲层级，并直接以 Mermaid 语法的 `mindmap` 代码块输出（如 ```mermaid\\nmindmap\\n  root((主题))\\n    一级分支\\n      二级细节\\n```）。除了该代码块外，严禁输出任何额外文字或解释。';
        case 'custom':
        default:
            return customPrompt
                ? `你是一名专业高效的个人知识库 AI 创作助理。请严格根据用户的个性化要求处理输入文本。用户的具体要求是：${customPrompt}`
                : '你是一名专业高效的个人知识库 AI 助理。请直接针对用户的文本提供专业回答。';
    }
};

/**
 * 构造与大模型交互的完整上下文消息数组
 */
const buildMessages = ({ action, text, noteTitle, customPrompt }) => {
    const systemPrompt = getSystemPrompt(action, customPrompt);
    const messages = [{ role: 'system', content: systemPrompt }];

    let userContent = '';
    if (noteTitle) {
        userContent += `【当前笔记标题】：${noteTitle}\n\n`;
    }

    if (action === 'custom' && customPrompt) {
        userContent += `【指令要求】：${customPrompt}\n\n`;
    }

    userContent += `【正文内容】：\n${text}`;
    messages.push({ role: 'user', content: userContent });

    return messages;
};

/**
 * 校验并测试第三方 OpenAI 兼容端点连通性
 */
const testEndpointConnection = async ({ baseUrl, apiKey, model }) => {
    const cleanUrl = (baseUrl || '').trim().replace(/\/+$/, '');
    const cleanKey = (apiKey || '').trim();
    const cleanModel = (model || '').trim();

    if (!cleanUrl || !cleanKey || !cleanModel) {
        throw new Error('请完整填写 Base URL、API Key 与 模型名称');
    }

    const endpoint = `${cleanUrl}/chat/completions`;
    const startTime = Date.now();

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify({
            model: cleanModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 10,
            stream: false
        })
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `连接失败 (HTTP ${response.status})`;
        try {
            const parsed = JSON.parse(errorText);
            errorMsg = parsed?.error?.message || errorMsg;
        } catch {
            errorMsg = errorText.slice(0, 150) || errorMsg;
        }
        throw new Error(errorMsg);
    }

    return {
        success: true,
        latencyMs,
        model: cleanModel
    };
};

module.exports = {
    resolveAIConfig,
    getSystemPrompt,
    buildMessages,
    testEndpointConnection
};
