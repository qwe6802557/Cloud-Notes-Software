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
