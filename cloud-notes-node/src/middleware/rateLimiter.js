const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const createRateLimitHandler = message => (req, res) => {
    res.status(429).json({
        code: 429,
        message,
        data: null
    });
};

const createLimiter = ({ windowMs, max, message, skipSuccessfulRequests = false }) => rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: createRateLimitHandler(message)
});

const loginLimiter = createLimiter({
    ...config.rateLimit.login,
    message: '登录尝试过于频繁，请稍后再试',
    skipSuccessfulRequests: true
});

const verifyCodeLimiter = createLimiter({
    ...config.rateLimit.verifyCode,
    message: '验证码请求过于频繁，请稍后再试'
});

const uploadLimiter = createLimiter({
    ...config.rateLimit.upload,
    message: '图片上传过于频繁，请稍后再试'
});

module.exports = {
    loginLimiter,
    verifyCodeLimiter,
    uploadLimiter
};
