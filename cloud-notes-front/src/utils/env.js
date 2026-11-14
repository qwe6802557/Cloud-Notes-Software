const DEFAULT_PROD_API_URL = 'https://notes.yanggenbwebsite.site/api';

/**
 * 判断当前是否运行于 Electron 桌面端环境
 */
export function isElectronApp() {
    return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
}

/**
 * 判断当前是否以 file:// 协议运行（桌面端打包加载本地 build/index.html）
 */
export function isFileProtocol() {
    return typeof window !== 'undefined' && window.location?.protocol === 'file:';
}

/**
 * 桌面端与 file:// 协议统一启用 HashRouter，避免刷新或硬跳转触发 file:///C:/... 白屏
 */
export function shouldUseHashRouter() {
    return isElectronApp() || isFileProtocol();
}

/**
 * 获取统一 API 基地址（优先读取 REACT_APP_API_URL，桌面/离线打包态兜底线上域名）
 */
export function getApiBaseUrl() {
    const envUrl = (process.env.REACT_APP_API_URL || '').trim();
    if (envUrl) {
        return envUrl.replace(/\/+$/, '') || '/api';
    }
    if (shouldUseHashRouter()) {
        return DEFAULT_PROD_API_URL;
    }
    return '/api';
}

/**
 * 提取 API 源域名，用于补全 file:// 下遗留相对资源路径
 */
export function getApiOrigin() {
    const apiBase = getApiBaseUrl();
    if (/^https?:\/\//i.test(apiBase)) {
        try {
            return new URL(apiBase).origin;
        } catch {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && /^https?:$/i.test(window.location?.protocol || '')) {
        return window.location.origin;
    }
    return 'https://notes.yanggenbwebsite.site';
}

/**
 * 将历史笔记/头像/文件暂存中的相对 /uploads/... 路径在打包态安全补全为完整 HTTPS URL
 */
export function resolveAssetUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
        return rawUrl;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed || /^(https?:|data:|blob:)/i.test(trimmed)) {
        return rawUrl;
    }

    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
        const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
        if (shouldUseHashRouter() || /^https?:\/\//i.test(getApiBaseUrl())) {
            return `${getApiOrigin()}${normalizedPath}`;
        }
        return normalizedPath;
    }

    return rawUrl;
}

/**
 * 获取规范化 Web 登录路径
 */
export function getWebLoginPath() {
    const rawBasename = (process.env.REACT_APP_ROUTER_URL || '').trim();
    const normalizedBasename = rawBasename.replace(/^\/+|\/+$/g, '');
    return normalizedBasename ? `/${normalizedBasename}/login` : '/login';
}

/**
 * 获取当前应用内路径（HashRouter 下读取 hash 内部路由，Web 下读取 pathname+search+hash）
 */
export function getCurrentRouteTarget() {
    if (typeof window === 'undefined') {
        return '/';
    }
    if (shouldUseHashRouter()) {
        const hash = window.location.hash || '';
        const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
        return cleaned.startsWith('/') ? cleaned : `/${cleaned || ''}`;
    }
    return window.location.pathname + window.location.search + window.location.hash;
}

/**
 * 判断给定路径或当前页是否为登录/注册认证页
 */
export function isAuthRoute(targetPath = getCurrentRouteTarget()) {
    const pathOnly = String(targetPath || '/').split('?')[0];
    return pathOnly.endsWith('/login') || pathOnly.endsWith('/register');
}

/**
 * 环境自适应跳转至登录页（HashRouter 下更新 location.hash 而不重载 file:// 页面）
 */
export function navigateToLogin(redirectTarget = '') {
    if (typeof window === 'undefined') {
        return;
    }
    const safeRedirect =
        redirectTarget &&
        redirectTarget.startsWith('/') &&
        !redirectTarget.startsWith('//') &&
        !isAuthRoute(redirectTarget)
            ? redirectTarget
            : '';

    if (shouldUseHashRouter()) {
        const targetHash = safeRedirect
            ? `#/login?redirect=${encodeURIComponent(safeRedirect)}`
            : '#/login';
        if (window.location.hash !== targetHash) {
            window.location.hash = targetHash;
        }
        return;
    }

    const baseLogin = getWebLoginPath();
    window.location.href = safeRedirect
        ? `${baseLogin}?redirect=${encodeURIComponent(safeRedirect)}`
        : baseLogin;
}
