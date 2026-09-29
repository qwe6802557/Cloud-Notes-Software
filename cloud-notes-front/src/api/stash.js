import request from '@/utils/request';

/**
 * 获取暂存文件列表
 * @param {string} [type] 'temp' | 'permanent'
 */
export const getStashFiles = type => {
    return request({
        url: '/stash',
        method: 'get',
        params: type ? { type } : {}
    });
};

/**
 * 上传文件到暂存区 (支持 FormData，自动由 request 拦截器处理)
 * @param {FormData} formData 包含 file 与 storageType ('temp' | 'permanent')
 * @param {Function} [onUploadProgress] 上传进度回调
 */
export const uploadStashFile = (formData, onUploadProgress) => {
    return request({
        url: '/stash/upload',
        method: 'post',
        data: formData,
        onUploadProgress
    });
};

/**
 * 将临时文件升级为永久保存
 * @param {string} id 文件ID
 */
export const promoteStashFile = id => {
    return request({
        url: `/stash/${id}/promote`,
        method: 'post'
    });
};

/**
 * 手动删除暂存文件
 * @param {string} id 文件ID
 */
export const deleteStashFile = id => {
    return request({
        url: `/stash/${id}`,
        method: 'delete'
    });
};
