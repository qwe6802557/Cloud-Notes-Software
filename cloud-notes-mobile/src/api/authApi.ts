import request from './client';
import { ApiResponse, CaptchaData, LoginResponseData, User } from './types';

// 获取图形验证码
export const getCaptcha = (): Promise<ApiResponse<CaptchaData>> => {
  return request({
    url: '/auth/captcha',
    method: 'get',
  });
};

// 账号密码登录
export const login = (data: {
  account: string;
  password: string;
  captcha?: string;
  captchaKey?: string;
}): Promise<ApiResponse<LoginResponseData>> => {
  return request({
    url: '/auth/login',
    method: 'post',
    data,
  });
};

// 注册新用户
export const register = (data: any): Promise<ApiResponse<any>> => {
  return request({
    url: '/auth/register',
    method: 'post',
    data,
  });
};

// 获取当前登录用户信息
export const getCurrentUser = (): Promise<ApiResponse<User>> => {
  return request({
    url: '/auth/currentUser',
    method: 'get',
  });
};

// 退出登录
export const logout = (): Promise<ApiResponse<any>> => {
  return request({
    url: '/auth/logout',
    method: 'post',
  });
};
