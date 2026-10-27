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
export const getCurrentUser = async (): Promise<ApiResponse<User>> => {
  const res: any = await request({
    url: '/auth/currentUser',
    method: 'get',
  });
  return {
    ...res,
    data: res?.data?.user || res?.data,
  };
};

// 获取安全箱配置状态
export const getVaultStatus = (): Promise<ApiResponse<{ enabled: boolean; salt?: string; hint?: string }>> => {
  return request({
    url: '/auth/vault-status',
    method: 'get',
  });
};

// 初始化设置安全箱
export const setupVault = (data: { pin: string; hint?: string }): Promise<ApiResponse<any>> => {
  return request({
    url: '/auth/vault-setup',
    method: 'post',
    data,
  });
};

// 验证安全箱密码
export const verifyVault = (data: { pin: string }): Promise<ApiResponse<{ verified: boolean; salt: string }>> => {
  return request({
    url: '/auth/vault-verify',
    method: 'post',
    data,
  });
};

// 退出登录
export const logout = (): Promise<ApiResponse<any>> => {
  return request({
    url: '/auth/logout',
    method: 'post',
  });
};
