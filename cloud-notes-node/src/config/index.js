require('dotenv').config();

const path = require('path');

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const appRoot = path.resolve(__dirname, '..', '..');
const defaultUploadPath = 'uploads/';

const normalizeBaseUrl = value => {
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    return trimmedValue ? trimmedValue.replace(/\/+$/, '') : '';
};

const normalizeOrigin = origin => {
    const normalizedOrigin = normalizeBaseUrl(origin);
    if (!normalizedOrigin) {
        return '';
    }

    try {
        return new URL(normalizedOrigin).origin;
    } catch (error) {
        return normalizedOrigin;
    }
};

const parseOrigins = value => {
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map(normalizeOrigin)
        .filter(Boolean);
};

const parsePositiveInt = (value, fallback) => {
    const parsedValue = parseInt(value, 10);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const parseTrustProxy = value => {
    if (value === undefined || value === '') {
        return isProduction ? 1 : false;
    }

    if (value === 'true') {
        return 1;
    }

    if (value === 'false') {
        return false;
    }

    const parsedValue = Number(value);
    return Number.isInteger(parsedValue) ? parsedValue : value;
};

const resolveUploadPath = uploadPath => {
    const rawPath = typeof uploadPath === 'string' ? uploadPath.trim() : '';
    const normalizedPath = rawPath || defaultUploadPath;

    return path.isAbsolute(normalizedPath)
        ? path.normalize(normalizedPath)
        : path.resolve(appRoot, normalizedPath);
};

const validateSecret = (key, value) => {
    const weakDefaults = ['cloud_jwt_secret_key', 'cloud_session_secret_key'];

    if (!value || weakDefaults.includes(value) || value.length < 48) {
        console.error(`生产环境必须设置高强度 ${key}，长度建议不少于 48 字符`);
        process.exit(1);
    }
};

const configuredUploadPath = process.env.UPLOAD_PATH || defaultUploadPath;
const uploadRootPath = resolveUploadPath(configuredUploadPath);
const configuredCorsOrigins = parseOrigins(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN);
const corsOrigins = configuredCorsOrigins.length > 0
    ? configuredCorsOrigins
    : (isProduction ? [] : ['http://localhost:3000']);
const publicBaseUrl = normalizeBaseUrl(process.env.PUBLIC_BASE_URL);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

const validateHttpUrl = (key, value) => {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('invalid protocol');
        }
    } catch (error) {
        console.error(`${key} 必须是有效的 HTTP/HTTPS 地址`);
        process.exit(1);
    }
};

if (isProduction) {
    validateSecret('JWT_SECRET', process.env.JWT_SECRET);
    validateSecret('SESSION_KEY', process.env.SESSION_KEY);

    if (process.env.JWT_SECRET === process.env.SESSION_KEY) {
        console.error('JWT_SECRET 和 SESSION_KEY 不能相同');
        process.exit(1);
    }

    if (!process.env.UPLOAD_PATH || !path.isAbsolute(process.env.UPLOAD_PATH.trim())) {
        console.error('生产环境必须将 UPLOAD_PATH 设置为独立的绝对路径，例如 /var/lib/cloud-notes/uploads');
        process.exit(1);
    }

    if (corsOrigins.length === 0) {
        console.error('生产环境必须设置 CORS_ORIGINS，例如 https://notes.example.com');
        process.exit(1);
    }

    corsOrigins.forEach(origin => validateHttpUrl('CORS_ORIGINS', origin));

    if (!publicBaseUrl) {
        console.error('生产环境必须设置 PUBLIC_BASE_URL，例如 https://notes.example.com');
        process.exit(1);
    }

    validateHttpUrl('PUBLIC_BASE_URL', publicBaseUrl);
}

module.exports = {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001,
    mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_note',
    jwtSecret: process.env.JWT_SECRET || 'cloud_jwt_secret_key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    sessionKey: process.env.SESSION_KEY || 'cloud_session_secret_key',
    publicBaseUrl,
    trustProxy,
    cors: {
        allowedOrigins: corsOrigins
    },
    rateLimit: {
        login: {
            windowMs: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
            max: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10)
        },
        verifyCode: {
            windowMs: parsePositiveInt(process.env.VERIFY_CODE_RATE_LIMIT_WINDOW_MS, 60 * 60 * 1000),
            max: parsePositiveInt(process.env.VERIFY_CODE_RATE_LIMIT_MAX, 5)
        },
        upload: {
            windowMs: parsePositiveInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS, 60 * 1000),
            max: parsePositiveInt(process.env.UPLOAD_RATE_LIMIT_MAX, 20)
        }
    },
    email: {
        accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID || '',
        accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET || '',
        region: process.env.ALIYUN_REGION || 'cn-hangzhou',
        fromEmail: process.env.ALIYUN_FROM_EMAIL || '',
        fromName: process.env.ALIYUN_FROM_NAME || '囧人云笔记',
        replyEmail: process.env.ALIYUN_REPLY_EMAIL || '',
        connectTimeoutMs: parseInt(process.env.ALIYUN_DM_CONNECT_TIMEOUT_MS, 10) || 5000,
        readTimeoutMs: parseInt(process.env.ALIYUN_DM_READ_TIMEOUT_MS, 10) || 15000,
        maxAttempts: parseInt(process.env.ALIYUN_DM_MAX_ATTEMPTS, 10) || 2
    },
    uploads: {
        // 上传目录统一解析为绝对路径，生产环境应指向应用目录外的持久化存储。
        path: uploadRootPath,
        maxSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024,
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    }
};
