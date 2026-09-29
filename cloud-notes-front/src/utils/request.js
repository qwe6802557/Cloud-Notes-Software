import axios from 'axios';
import { message } from 'antd';
import { clearAuth, getToken } from './auth';

const isFormData = data => typeof FormData !== 'undefined' && data instanceof FormData;

// 获取规范化的登录页完整路径（彻底清洗斜杠，杜绝 //login 协议相对 URL 异常）
export const getLoginPath = () => {
    const rawBasename = (process.env.REACT_APP_ROUTER_URL || '').trim();
    const normalizedBasename = rawBasename.replace(/^\/+|\/+$/g, '');
    return normalizedBasename ? `/${normalizedBasename}/login` : '/login';
};

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
    // 1. 同步清空本地认证凭据
    clearAuth();

    // 2. 特殊场景放行：当前已在登录/注册页，或当前请求本身为登录接口（如密码错误返回 401），不触发重定向
    const currentPath = window.location.pathname;
    const isLoginRequest = config?.url && (config.url.includes('/login') || config.url.includes('/auth/login'));
    const isAuthPage = currentPath.endsWith('/login') || currentPath.endsWith('/register');

    if (isLoginRequest || isAuthPage) {
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

    // 4. 构造带 redirect 参数的登录目标路径，以便重新登录后自动回跳
    const targetLoginPath = getLoginPath();
    const currentFullUrl = window.location.pathname + window.location.search + window.location.hash;
    const redirectQuery = currentFullUrl && !isAuthPage
        ? `?redirect=${encodeURIComponent(currentFullUrl)}`
        : '';
    const fullTarget = `${targetLoginPath}${redirectQuery}`;

    // 5. 留出 600ms 平滑延时，确保用户看清提示后安全跳转
    if (authRedirectTimer) {
        clearTimeout(authRedirectTimer);
    }
    authRedirectTimer = setTimeout(() => {
        if (!window.location.pathname.endsWith('/login')) {
            window.location.href = fullTarget;
        } else {
            isAuthRedirecting = false;
        }
    }, 600);

    // 6. 核心拦截：返回静默挂起的 Promise，彻底阻止下游业务组件进入 catch 弹出次生错误（如“笔记本加载失败”）
    return new Promise(() => {});
};

const request = axios.create({
    baseURL: process.env.REACT_APP_API_URL || '/api', // 从环境变量获取API地址
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

            message.error(res.message || '请求失败');
            return Promise.reject(new Error(res.message || '请求失败'));
        }

        return res.data; // 返回数据部分
    },
    error => {
        let errorMessage = '网络请求失败';

        if (error.response) {
            // 服务器错误状态码
            const status = error.response.status;
            const responseMessage = error.response.data?.message;

            // 统一 401 处理：拦截所有 HTTP 401 状态码，静默防抖挂起并执行回跳重定向
            if (status === 401) {
                return handleAuthExpired(responseMessage, error.config);
            }

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
                case 500:
                    errorMessage = responseMessage || '服务器内部错误';
                    break;
                default:
                    errorMessage = responseMessage || `请求失败(${status})`;
            }
        } else if (error.request) {
            // 未收到响应
            errorMessage = '服务器无响应';
        }

        message.error(errorMessage);
        console.error('响应错误:', error);

        return Promise.reject(error);
    }
);

export default request;
