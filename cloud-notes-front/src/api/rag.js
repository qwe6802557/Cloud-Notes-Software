import request from '@/utils/request';

/**
 * 获取用户当前知识库索引统计
 */
export const getRAGStats = () => {
    return request({
        url: '/ai/rag/stats',
        method: 'get'
    });
};

/**
 * 触发全库笔记构建或重新生成向量索引
 */
export const triggerReindex = () => {
    return request({
        url: '/ai/rag/reindex',
        method: 'post'
    });
};

/**
 * 知识库检索测试
 */
export const searchKnowledge = data => {
    return request({
        url: '/ai/rag/search',
        method: 'post',
        data
    });
};

/**
 * 获取指定笔记的语义强相关推荐笔记
 */
export const getRelatedNotes = (noteId, params = {}) => {
    return request({
        url: `/ai/rag/related-notes/${noteId}`,
        method: 'get',
        params
    });
};

/**
 * 获取全库知识图谱语义连线
 */
export const getSemanticGraph = (params = {}) => {
    return request({
        url: '/ai/rag/semantic-graph',
        method: 'get',
        params
    });
};

