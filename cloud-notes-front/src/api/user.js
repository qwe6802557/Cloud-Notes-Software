import request from "@/utils/request";

// 获取图形验证码
export const getCaptcha = () => {
    return request({
        url: '/auth/captcha',
        method: 'get'
    });
};

// 登录
export const login = data => {
    return request({
        url: '/auth/login',
        method: 'post',
        data
    });
};

// 注册
export const register = data => {
    return request({
        url: '/auth/register',
        method: 'post',
        data
    });
};

// 发送验证码
export const sendVerificationCode = params => {
    return request({
        url: '/auth/verifyCode',
        method: 'get',
        params
    });
};

// 获取用户信息
export const getUserInfo = params => {
    return request({
        url: '/auth/currentUser',
        method: 'get',
        params
    });
};

// 更新用户信息
export const updateUserInfo = data => {
    return request({
        url: '/auth/currentUser',
        method: 'put',
        data
    });
};

// 退出登录
export const logout = () => {
    return request({
        url: '/auth/logout',
        method: 'post'
    });
};
