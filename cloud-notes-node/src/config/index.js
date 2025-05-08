require('dotenv').config();

module.exports = {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/cloud_note',
    jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    // 文件上传配置
    uploads: {
        path: process.env.UPLOAD_PATH || 'uploads/',
        maxSize: process.env.MAX_FILE_SIZE || 5 * 1024 * 1024, // 5MB
        allowedTypes: ['image/jpeg', 'image/png', 'image/gif']
    }
};