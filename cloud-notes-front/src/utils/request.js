import axios from 'axios';
import { message } from 'antd';
import { clearAuth, getToken } from './auth';
import {
    getApiBaseUrl,
    getCurrentRouteTarget,
    getWebLoginPath,
    isAuthRoute,
    navigateToLogin
} from './env';

const isFormData = data => typeof FormData !== 'undefined' && data instanceof FormData;

// 获取规范化的登录页完整路径（彻底清洗斜杠，杜绝 //login 协议相对 URL 异常）
export const getLoginPath = () => getWebLoginPath();

// 401 单例防抖与重定向状态锁
let isAuthRedirecting = false;
let authRedirectTimer = null;

/**
 * 统一处理 401 令牌过期/未授权异常
 * @param {string} customMessage 后端提示或自定义文案
 * @param {object} config 当前请求配置
 * @returns {Promise}
 */
const handleAuthExpired = (customMessage, config) => {
    if (config?.url && config.url.includes('/vault')) {
        return Promise.reject(new Error(customMessage || '安全密码不正确'));
    }
    // 1. 同步清空本地认证凭据
    clearAuth();

    // 2. 特殊场景放行：当前已在登录/注册页，或当前请求本身为登录接口（如密码错误返回 401），不触发重定向
    const currentRoute = getCurrentRouteTarget();
    const isLoginRequest = config?.url && (config.url.includes('/login') || config.url.includes('/auth/login'));
    const isOnAuthPage = isAuthRoute(currentRoute);

    if (isLoginRequest || isOnAuthPage) {
        const errorMsg = customMessage || '未授权，请重新登录';
        message.error(errorMsg);
        return Promise.reject(new Error(errorMsg));
    }

    // 3. 并发防抖：若已有 401 触发了重定向倒计时，直接挂起，杜绝多次弹窗与重复定时器
    if (isAuthRedirecting) {
        return new Promise(() => {});
    }

    isAuthRedirecting = true;
    const errorMsg = customMessage || '登录状态已过期，请重新登录';
    message.error(errorMsg);

    // 4. 留出 600ms 平滑延时，确保用户看清提示后安全跳转（兼容 BrowserRouter 与 HashRouter）
    if (authRedirectTimer) {
        clearTimeout(authRedirectTimer);
    }
    authRedirectTimer = setTimeout(() => {
        if (!isAuthRoute()) {
            navigateToLogin(currentRoute);
        }
        isAuthRedirecting = false;
    }, 600);

    // 5. 核心拦截：返回静默挂起的 Promise，彻底阻止下游业务组件进入 catch 弹出次生错误（如“笔记本加载失败”）
    return new Promise(() => {});
};

const request = axios.create({
    baseURL: getApiBaseUrl(), // 自动适配 Web 代理与 Electron 打包态域名
    timeout: 60000, // 请求超时时间
    headers: {
        'Content-Type': 'application/json;charset=UTF-8',
    },
    transformRequest: [function(data) {
        return data
    }]
});

// 请求拦截器
request.interceptors.request.use(
    config => {
        if(config.data && !isFormData(config.data)){
            config.headers['Content-Type'] = 'application/json;charset=UTF-8'
            config.data = JSON.stringify(config.data)
        } else if (isFormData(config.data)) {
            delete config.headers['Content-Type'];
        }
        if(config.method === 'get'){
            config.params  =  config.params || {}
            config.params.t = new Date().getTime()
        }
        const token = getToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config
    },
    error => {
        console.error('请求错误:', error);
        return Promise.reject(error);
    }
);

// 响应拦截器
request.interceptors.response.use(
    response => {
        // 直接返回响应数据部分
        const res = response.data;

        if(res instanceof Blob) {
            return response;
        }

        // 假设接口返回格式为: { code: 200, data: any, message: string }
        if (res.code !== 200) {
            // 处理特定错误码, 如401未授权
            if (res.code === 401) {
                return handleAuthExpired(res.message, response.config);
            }

            const bizError = new Error(res.message || '请求失败');
            bizError.status = res.code;
            bizError.conflictData = res.data || null;
            bizError.responseData = res;

            // 409 版本冲突与显式 skipErrorToast 请求交由调用方处理，不触发全局错误弹窗
            if (res.code !== 409 && !response.config?.skipErrorToast) {
                message.error(res.message || '请求失败');
            }
            return Promise.reject(bizError);
        }

        return res.data; // 返回数据部分
    },
    error => {
        let errorMessage = '网络请求失败';
        const skipToast = Boolean(error.config?.skipErrorToast);

        if (error.response) {
            // 服务器错误状态码
            const status = error.response.status;
            const responseMessage = error.response.data?.message;

            // 统一 401 处理：拦截所有 HTTP 401 状态码，静默防抖挂起并执行回跳重定向
            if (status === 401) {
                return handleAuthExpired(responseMessage, error.config);
            }

            // 透传状态码与 409 冲突载荷（含 serverNote），供 syncManager 判定与弹窗裁决
            error.status = status;
            error.conflictData = error.response.data?.data || null;
            error.responseData = error.response.data || null;

            switch(status) {
                case 400:
                    errorMessage = responseMessage || '请求参数错误';
                    break;
                case 403:
                    errorMessage = responseMessage || '拒绝访问';
                    break;
                case 404:
                    errorMessage = responseMessage || '请求的资源不存在';
                    break;
                case 409:
                    errorMessage = responseMessage || '笔记存在版本冲突';
                    break;
                case 500:
                    errorMessage = responseMessage || '服务器内部错误';
                    break;
                default:
                    errorMessage = responseMessage || `请求失败(${status})`;
            }

            if (status !== 409 && !skipToast) {
                message.error(errorMessage);
            }
        } else if (error.request) {
            // 未收到响应
            errorMessage = '服务器无响应';
            if (!skipToast) {
                message.error(errorMessage);
            }
        } else if (!skipToast) {
            message.error(errorMessage);
        }

        if (error.response?.status !== 409) {
            console.error('响应错误:', error);
        }

        return Promise.reject(error);
    }
);

export default request;
