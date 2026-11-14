/**
 * Electron 打包态 (file://) API CORS 头部改写纯函数
 * 仅用于针对 apiOrigin/* 的 webRequest 拦截，不依赖 electron 运行时模块以便单测覆盖。
 */

const isOpaqueOrFileOrigin = (originValue) => {
    const normalized = String(originValue || '').trim().toLowerCase();
    return !normalized || normalized === 'null' || normalized.startsWith('file://');
};

/**
 * 在发送至 API 之前，将来自 file:// / null 的 Origin 改写为 apiOrigin，以便服务端正常放行
 */
const rewriteApiCorsRequestHeaders = (requestHeaders = {}, apiOrigin) => {
    const headers = { ...requestHeaders };
    const existingKey = Object.keys(headers).find((k) => k.toLowerCase() === 'origin');
    const currentOrigin = existingKey ? headers[existingKey] : '';

    if (isOpaqueOrFileOrigin(currentOrigin)) {
        if (existingKey && existingKey !== 'Origin') {
            delete headers[existingKey];
        }
        headers.Origin = apiOrigin;
    }
    return headers;
};

/**
 * 响应返回 Chromium 时，针对 file:// 或 null 发起方统一放行 Access-Control-Allow-Origin: *
 * 避免服务端回传 apiOrigin 时触发 Blink 严格 Origin === 'null' 比对失败
 */
const rewriteApiCorsResponseHeaders = (responseHeaders = {}, initiator = '') => {
    const headers = { ...responseHeaders };
    if (!isOpaqueOrFileOrigin(initiator)) {
        return headers;
    }

    for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower === 'access-control-allow-origin' || lower === 'access-control-allow-credentials') {
            delete headers[key];
        }
    }
    headers['Access-Control-Allow-Origin'] = ['*'];
    return headers;
};

module.exports = {
    isOpaqueOrFileOrigin,
    rewriteApiCorsRequestHeaders,
    rewriteApiCorsResponseHeaders
};
