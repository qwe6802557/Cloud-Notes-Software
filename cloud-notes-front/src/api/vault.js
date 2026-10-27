import request from '@/utils/request';

// 获取安全箱配置状态
export const getVaultStatus = () => {
    return request({
        url: '/auth/vault-status',
        method: 'get'
    });
};

// 初始化设置安全箱
export const setupVault = (data) => {
    return request({
        url: '/auth/vault-setup',
        method: 'post',
        data
    });
};

// 验证安全箱密码
export const verifyVault = (data) => {
    return request({
        url: '/auth/vault-verify',
        method: 'post',
        data
    });
};

// 更新安全箱密码
export const updateVault = (data) => {
    return request({
        url: '/auth/vault-update',
        method: 'post',
        data
    });
};
