// 验证码服务
const VerificationCode = require('../models/VerificationCode');
const AppError = require('../utils/AppError');

// 生成随机验证码
const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// 发送短信验证码 (实际实现会调用短信API)
exports.sendVerificationCode = async (phone) => {
    // 检查是否频繁发送
    const existingCode = await VerificationCode.findOne({ phone });
    if (existingCode) {
        const timeDiff = Date.now() - existingCode.createdAt.getTime();
        // 1分钟内不允许重复发送
        if (timeDiff < 60000) {
            throw new AppError('请求过于频繁，请稍后再试', 400);
        }
        // 删除旧验证码
        await VerificationCode.deleteOne({ phone });
    }

    // 生成新验证码
    const code = generateVerificationCode();

    // 保存验证码到数据库
    await VerificationCode.create({ phone, code });

    // TODO: 实际发送短信的代码
    // 这里应该调用短信服务商的API发送短信
    console.log(`向 ${phone} 发送验证码: ${code}`);

    // 开发环境下可以返回验证码，生产环境中接入短信发送运营商
    return process.env.NODE_ENV === 'development' ? code : true;
};

// 验证短信验证码
exports.verifyCode = async (phone, code) => {
    // 查找验证码记录
    const verificationCode = await VerificationCode.findOne({ phone });

    // 验证码不存在或已过期
    if (!verificationCode) {
        throw new AppError('验证码不存在或已过期', 400);
    }

    // 验证码不匹配
    if (verificationCode.code !== code) {
        throw new AppError('验证码错误', 400);
    }

    // 验证成功后删除验证码记录
    await VerificationCode.deleteOne({ _id: verificationCode._id });

    return true;
};