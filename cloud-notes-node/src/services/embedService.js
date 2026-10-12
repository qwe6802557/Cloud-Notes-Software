const config = require('../config');

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 快速 32 位 FNV-1a 哈希函数
 */
const fnv1a = str => {
    let hash = FNV_OFFSET_BASIS;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, FNV_PRIME);
    }
    return hash >>> 0;
};

/**
 * 本地确定性高维特征哈希嵌入向量生成（支持中英文分词与 n-gram，零外部依赖）
 * @param {string} text 待编码文本
 * @param {number} dimensions 向量维度（默认 256）
 * @returns {number[]} L2 归一化后的浮点向量
 */
const generateLocalEmbedding = (text = '', dimensions = 256) => {
    const vec = new Float64Array(dimensions);
    const normalized = text.toLowerCase().trim();
    if (!normalized) return Array.from(vec);

    const tokens = [];
    const words = normalized.match(/[a-z0-9_-]+/g) || [];
    tokens.push(...words);

    const chineseChars = normalized.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < chineseChars.length; i++) {
        tokens.push(chineseChars[i]);
        if (i < chineseChars.length - 1) {
            tokens.push(chineseChars.slice(i, i + 2));
        }
    }

    if (tokens.length === 0) return Array.from(vec);

    for (const token of tokens) {
        const h = fnv1a(token);
        const index = h % dimensions;
        const sign = (h & 0x80000000) === 0 ? 1 : -1;
        vec[index] += sign;
    }

    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
        norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
        for (let i = 0; i < dimensions; i++) {
            vec[i] /= norm;
        }
    }

    return Array.from(vec);
};

/**
 * 解析用户向量嵌入模型与鉴权参数
 */
const resolveEmbeddingConfig = user => {
    if (user?.aiConfig?.enabled && user?.aiConfig?.apiKey && user?.aiConfig?.baseUrl) {
        return {
            apiKey: user.aiConfig.apiKey.trim(),
            baseUrl: user.aiConfig.baseUrl.trim().replace(/\/+$/, ''),
            model: user.aiConfig.embeddingModel || 'text-embedding-3-small'
        };
    }

    return {
        apiKey: config.ai.defaultApiKey,
        baseUrl: config.ai.defaultBaseUrl.replace(/\/+$/, ''),
        model: config.ai.defaultEmbeddingModel || 'text-embedding-3-small'
    };
};

/**
 * 批量获取文本列表的 Embedding 向量表示（优先远程神经网络向量，平滑降级为本地特征向量）
 * @param {string[]} texts 待向量化文本列表
 * @param {object} user 当前操作用户实体
 * @returns {Promise<number[][]>} 向量浮点数组列表
 */
const createEmbeddings = async (texts = [], user) => {
    if (!Array.isArray(texts) || texts.length === 0) {
        return [];
    }

    const embedConfig = resolveEmbeddingConfig(user);
    if (embedConfig.apiKey && embedConfig.baseUrl) {
        try {
            const endpoint = `${embedConfig.baseUrl}/embeddings`;
            const cleanTexts = texts.map(t => (t || '').slice(0, 4000).replace(/\r\n/g, '\n').trim() || ' ');

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${embedConfig.apiKey}`
                },
                body: JSON.stringify({
                    model: embedConfig.model,
                    input: cleanTexts
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data?.data && Array.isArray(data.data)) {
                    return data.data
                        .sort((a, b) => a.index - b.index)
                        .map(item => item.embedding);
                }
            }
        } catch {
            // 远程服务未就绪时平滑使用本地确定性哈希向量
        }
    }

    return texts.map(t => generateLocalEmbedding(t, 256));
};

/**
 * 计算两个高维向量之间的余弦相似度
 */
const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

module.exports = {
    resolveEmbeddingConfig,
    createEmbeddings,
    cosineSimilarity,
    generateLocalEmbedding
};
