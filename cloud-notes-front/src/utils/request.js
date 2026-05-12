import axios from 'axios';
import { message } from 'antd';
import { clearAuth, getToken } from './auth';

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

const redirectToLogin = () => {
    if (window.location.pathname !== '/login') {
        window.location.href = '/login';
    }
};

// 请求拦截器
request.interceptors.request.use(
    config => {
        if(config.data){
            config.headers['Content-Type'] = 'application/json;charset=UTF-8'
            config.data = JSON.stringify(config.data)
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
            message.error(res.message || '请求失败');

            // 处理特定错误码, 如401未授权
            if (res.code === 401) {
                // 重定向到登录页或清除本地token
                clearAuth();
                redirectToLogin();
            }

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

            switch(status) {
                case 400:
                    errorMessage = responseMessage || '请求参数错误';
                    break;
                case 401:
                    errorMessage = responseMessage || '未授权，请重新登录';
                    clearAuth();
                    redirectToLogin();
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