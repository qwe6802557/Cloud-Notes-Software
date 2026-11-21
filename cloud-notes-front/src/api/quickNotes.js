import request from '@/utils/request';

/**
 * 获取随心记统一时间流列表（包含未过期临时项、永久项与存量兼容 StashFile）
 * @param {object} [params] - { type?: 'temp'|'permanent', kind?: 'text'|'link'|'image'|'file', limit?: number }
 * @param {object} [config]
 */
export const getQuickNotes = (params = {}, config = {}) => {
    return request({
        url: '/quick-notes',
        method: 'get',
        params,
        ...config
    });
};

/**
 * 增量游标同步随心记变更（含软删墓碑与 legacyItems）
 * @param {object} [params] - { since, cursorId, limit }
 * @param {object} [config]
 */
export const deltaSyncQuickNotes = (params = {}, config = {}) => {
    return request({
        url: '/quick-notes/delta',
        method: 'get',
        params,
        ...config
    });
};

/**
 * 发送纯文本或链接随心记
 * @param {object} data - { content, storageType?: 'temp'|'permanent', ttlMinutes?: number, clientId?: string }
 * @param {object} [config]
 */
export const createQuickTextMemo = (data, config = {}) => {
    return request({
        url: '/quick-notes/text',
        method: 'post',
        data,
        ...config
    });
};

/**
 * 上传图片或文件至随心记（支持 FormData 进度回调）
 * @param {FormData} formData
 * @param {Function} [onUploadProgress]
 * @param {object} [config]
 */
export const uploadQuickMemoFile = (formData, onUploadProgress, config = {}) => {
    return request({
        url: '/quick-notes/upload',
        method: 'post',
        data: formData,
        onUploadProgress,
        ...config
    });
};

/**
 * 将临时随心记条目转为永久保留
 * @param {string} id
 * @param {object} [config]
 */
export const promoteQuickMemo = (id, config = {}) => {
    return request({
        url: `/quick-notes/${id}/promote`,
        method: 'post',
        ...config
    });
};

/**
 * 将临时随心记有效期延长 20 分钟
 * @param {string} id
 * @param {object} [config]
 */
export const extendQuickMemo = (id, config = {}) => {
    return request({
        url: `/quick-notes/${id}/extend`,
        method: 'post',
        ...config
    });
};

/**
 * 删除单条随心记及关联物理附件
 * @param {string} id
 * @param {object} [config]
 */
export const deleteQuickMemo = (id, config = {}) => {
    return request({
        url: `/quick-notes/${id}`,
        method: 'delete',
        ...config
    });
};

/**
 * 一键转存随心记为正式笔记（保留原随心记并回写 convertedNoteId）
 * @param {string} id
 * @param {object} [data] - { notebookId?, title? }
 * @param {object} [config]
 */
export const convertQuickMemoToNote = (id, data = {}, config = {}) => {
    return request({
        url: `/quick-notes/${id}/to-note`,
        method: 'post',
        data,
        ...config
    });
};

/**
 * 整文件夹一键转为永久保存
 * @param {string} folderName
 * @param {object} [config]
 */
export const promoteQuickMemoFolder = (folderName, config = {}) => {
    return request({
        url: '/quick-notes/folder/promote',
        method: 'post',
        data: { folderName },
        ...config
    });
};

/**
 * 彻底删除整个虚拟文件夹
 * @param {string} folderName
 * @param {string} storageType - 'temp' | 'permanent'
 * @param {object} [config]
 */
export const deleteQuickMemoFolder = (folderName, storageType, config = {}) => {
    return request({
        url: '/quick-notes/folder',
        method: 'delete',
        data: { folderName, storageType },
        ...config
    });
};

/**
 * 流式打包下载整个虚拟文件夹 (.zip)
 * @param {string} folderName
 * @param {string} storageType - 'temp' | 'permanent'
 * @param {object} [config]
 */
export const downloadQuickMemoFolder = (folderName, storageType, config = {}) => {
    return request({
        url: '/quick-notes/folder/download',
        method: 'get',
        params: { folderName, storageType },
        responseType: 'blob',
        ...config
    });
};
