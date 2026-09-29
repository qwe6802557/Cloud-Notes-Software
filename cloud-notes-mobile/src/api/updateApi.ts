import request from './client';
import { ApiResponse } from './types';

export interface AppUpdateData {
  hasUpdate: boolean;
  type: 'ota' | 'native';
  version: string;
  buildNumber: number;
  forceUpdate: boolean;
  minCompatibleVersion: string;
  title: string;
  changelog: string;
  downloadUrl: string;
  hash?: string;
  size?: number;
  apkUrl?: string;
  releaseDate?: string;
}

/**
 * 查询 App 最新版本与热更状态 (公开免鉴权)
 */
export const checkAppUpdate = (params: {
  platform: 'android' | 'ios' | 'web';
  currentVersion: string;
  buildNumber: number;
}): Promise<ApiResponse<AppUpdateData>> => {
  return request({
    url: '/app/check-update',
    method: 'get',
    params,
  });
};
