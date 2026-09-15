const svgCaptcha = require('svg-captcha');
const crypto = require('crypto');
const AppError = require('../utils/AppError');

const CAPTCHA_TTL_MS = 2 * 60 * 1000;
const captchaStore = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of captchaStore.entries()) {
        if (record.expiresAt <= now) {
            captchaStore.delete(key);
        }
    }
}, 60 * 1000).unref();

exports.generateCaptcha = () => {
    const captcha = svgCaptcha.create({
        size: 4,
        ignoreChars: '0o1ilI',
        noise: 2,
        color: true,
        background: '#f8fafc',
        width: 120,
        height: 40,
        fontSize: 38
    });

    const captchaKey = crypto.randomUUID();
    const expiresAt = Date.now() + CAPTCHA_TTL_MS;

    captchaStore.set(captchaKey, {
        text: captcha.text.toLowerCase(),
        expiresAt
    });

    return {
        captchaKey,
        svg: captcha.data
    };
};

exports.verifyCaptcha = (captchaKey, inputCode) => {
    if (!captchaKey) {
        throw new AppError('验证码已失效，请点击刷新', 400);
    }

    const record = captchaStore.get(captchaKey);
    captchaStore.delete(captchaKey);

    if (!record) {
        throw new AppError('验证码不存在或已过期，请重新获取', 400);
    }

    if (record.expiresAt <= Date.now()) {
        throw new AppError('验证码已过期，请点击刷新', 400);
    }

    if (!inputCode || record.text !== inputCode.trim().toLowerCase()) {
        throw new AppError('验证码不正确，请重新输入', 400);
    }

    return true;
};
