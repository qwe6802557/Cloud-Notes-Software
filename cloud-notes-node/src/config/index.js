require('dotenv').config();

module.exports = {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001,
    mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_note',
    jwtSecret: process.env.JWT_SECRET || 'cloud_jwt_secret_key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    sessionKey: process.env.SESSION_KEY || 'cloud_session_secret_key',
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
    // 文件上传配置
    uploads: {
        path: process.env.UPLOAD_PATH || 'uploads/',
        maxSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    }
};
