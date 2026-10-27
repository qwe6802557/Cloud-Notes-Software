import request from '@/utils/request';

let pendingNotebooksPromise = null;

// 获取笔记本列表（支持并发请求共享，消除多组件并发重复查询引起的后端聚合排队）
export const getNotebooks = () => {
    if (pendingNotebooksPromise) {
        return pendingNotebooksPromise;
    }

    pendingNotebooksPromise = request({
        url: '/notebooks',
        method: 'get'
    }).finally(() => {
        // 请求结束后微任务延迟释放，既能合并瞬间并发，又确保后续刷新获取最新数据
        setTimeout(() => {
            pendingNotebooksPromise = null;
        }, 100);
    });

    return pendingNotebooksPromise;
};

// 创建笔记本
export const createNotebook = data => {
    return request({
        url: '/notebooks',
        method: 'post',
        data
    });
};

// 更新笔记本
export const updateNotebook = (notebookId, data) => {
    return request({
        url: `/notebooks/${notebookId}`,
        method: 'put',
        data
    });
};

// 获取指定笔记本下的笔记列表
export const getNotebookNotes = (notebookId, params) => {
    return request({
        url: `/notes/notebook/${notebookId}`,
        method: 'get',
        params
    });
};

// 获取已删除的笔记
export const getDeletedNotes = params => {
    return request({
        url: '/notes/deleted',
        method: 'get',
        params
    });
};

// 获取最近文档
export const getRecentNotes = params => {
    return request({
        url: '/notes/recent',
        method: 'get',
        params
    });
};

// 获取已收藏的笔记列表
export const getStarredNotes = params => {
    return request({
        url: '/notes/starred',
        method: 'get',
        params
    });
};

// 获取笔记详情
export const getNoteDetail = noteId => {
    return request({
        url: `/notes/${noteId}`,
        method: 'get'
    });
};

// 创建笔记
export const createNote = data => {
    return request({
        url: '/notes',
        method: 'post',
        data
    });
};

// 更新笔记
export const updateNote = (noteId, data) => {
    return request({
        url: `/notes/${noteId}`,
        method: 'put',
        data
    });
};

// 更新笔记收藏
export const updateNoteStarred = (noteId, isStarred) => {
    return request({
        url: `/notes/${noteId}/starred`,
        method: 'put',
        data: {
            isStarred
        }
    });
};

// 删除笔记
export const deleteNote = noteId => {
    return request({
        url: `/notes/${noteId}`,
        method: 'delete'
    });
};

// 恢复笔记
export const restoreNote = noteId => {
    return request({
        url: `/notes/${noteId}/restore`,
        method: 'put'
    });
};

// 移动笔记或目录
export const moveNoteNode = (noteId, data) => {
    return request({
        url: `/notes/${noteId}/move`,
        method: 'put',
        data
    });
};

// 获取笔记历史版本列表
export const getNoteHistories = noteId => {
    return request({
        url: `/notes/${noteId}/histories`,
        method: 'get'
    });
};

// 获取历史版本详情
export const getNoteHistoryDetail = (noteId, historyId) => {
    return request({
        url: `/notes/${noteId}/histories/${historyId}`,
        method: 'get'
    });
};

// 回滚至指定历史版本
export const rollbackNoteHistory = (noteId, historyId) => {
    return request({
        url: `/notes/${noteId}/histories/${historyId}/rollback`,
        method: 'post'
    });
};

// 全局检索笔记
export const searchNotes = params => {
    return request({
        url: '/notes/search',
        method: 'get',
        params
    });
};

// 获取知识网络图谱数据 (支持全局与局部子图)
export const getKnowledgeGraph = params => {
    return request({
        url: '/notes/graph',
        method: 'get',
        params
    });
};

// 联想笔记双链候选项
export const suggestNoteLinks = keyword => {
    return request({
        url: '/notes/suggest-links',
        method: 'get',
        params: { keyword }
    });
};

// 获取知识库轻量词典（供 Ghost Link 主动概念感知毫秒级离线匹配）
export const getNoteDictionary = () => {
    return request({
        url: '/notes/dictionary',
        method: 'get'
    });
};

// 获取单篇笔记的反向链接 (Backlinks)
export const getNoteBacklinks = noteId => {
    return request({
        url: `/notes/${noteId}/backlinks`,
        method: 'get'
    });
};

// 导出笔记为独立离线 Zip 归档包
export const exportNoteZip = noteId => {
    return request({
        url: `/notes/${noteId}/export-zip`,
        method: 'get',
        responseType: 'blob'
    });
};

// 同步离线全库轻量索引（用于客户端 Local-First 倒排索引构建）
export const syncNoteIndex = params => {
    return request({
        url: '/notes/index-sync',
        method: 'get',
        params
    });
};

// 获取所有可移动目标位置（全量笔记本与嵌套文件夹树）
export const getTargetDestinations = () => {
    return request({
        url: '/notes/target-destinations',
        method: 'get'
    });
};



