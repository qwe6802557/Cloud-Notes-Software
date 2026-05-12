const VerificationCode = require('../models/VerificationCode');
const AppError = require('../utils/AppError');
const config = require('../config');

let Dm20151123;
let OpenApi;
let Dara;

try {
    Dm20151123 = require('@alicloud/dm20151123');
    OpenApi = require('@alicloud/openapi-client');
    Dara = require('@darabonba/typescript');
} catch (error) {
    Dm20151123 = null;
    OpenApi = null;
    Dara = null;
}

const generateVerificationCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

const maskEmail = email => {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) {
        return '***';
    }

    if (localPart.length <= 2) {
        return `${localPart[0] || '*'}***@${domain}`;
    }

    return `${localPart.slice(0, 2)}***@${domain}`;
};

const canSendRealEmail = () => {
    return Boolean(
        Dm20151123 &&
        OpenApi &&
        Dara &&
        config.email.accessKeyId &&
        config.email.accessKeySecret &&
        config.email.fromEmail
    );
};

const createClient = () => {
    const Client = Dm20151123.default || Dm20151123;
    const sdkConfig = new OpenApi.Config({
        accessKeyId: config.email.accessKeyId,
        accessKeySecret: config.email.accessKeySecret,
        endpoint: 'dm.aliyuncs.com'
    });

    return new Client(sdkConfig);
};

const sendVerificationEmail = async (email, code) => {
    const client = createClient();
    const htmlBody = `
        <div style="font-family: Arial, sans-serif; line-height: 1.8; color: #333;">
            <h2>囧人云笔记邮箱验证码</h2>
            <p>您的验证码是：</p>
            <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #1677ff;">${code}</p>
            <p>验证码 5 分钟内有效，请勿泄露给他人。</p>
        </div>
    `;
    const textBody = `囧人云笔记邮箱验证码：${code}，5分钟内有效，请勿泄露给他人。`;
    const request = new Dm20151123.SingleSendMailRequest({
        accountName: config.email.fromEmail,
        addressType: 1,
        replyToAddress: true,
        toAddress: email,
        fromAlias: config.email.fromName,
        subject: '【囧人云笔记】邮箱验证码',
        htmlBody,
        textBody
    });
    const runtime = new Dara.RuntimeOptions({
        autoretry: true,
        maxAttempts: config.email.maxAttempts,
        readTimeout: config.email.readTimeoutMs,
        connectTimeout: config.email.connectTimeoutMs
    });

    const response = await client.singleSendMailWithOptions(request, runtime);
    if (response.statusCode !== 200) {
        throw new Error(`邮件服务返回异常状态码: ${response.statusCode}`);
    }
};

exports.sendVerificationCode = async (email) => {
    const normalizedEmail = email.toLowerCase();
    const existingCode = await VerificationCode.findOne({ email: normalizedEmail });

    if (existingCode) {
        const timeDiff = Date.now() - existingCode.createdAt.getTime();
        if (timeDiff < 60000) {
            throw new AppError('请求过于频繁，请稍后再试', 400);
        }
        await VerificationCode.deleteOne({ email: normalizedEmail });
    }

    const code = generateVerificationCode();
    await VerificationCode.create({ email: normalizedEmail, code });

    if (!canSendRealEmail()) {
        if (config.environment === 'production') {
            await VerificationCode.deleteOne({ email: normalizedEmail });
            throw new AppError('邮件服务未配置，无法发送验证码', 500);
        }

        console.log(`向 ${maskEmail(normalizedEmail)} 发送邮箱验证码: ${code}`);
        return code;
    }

    try {
        await sendVerificationEmail(normalizedEmail, code);
        return config.environment === 'development' ? code : true;
    } catch (error) {
        await VerificationCode.deleteOne({ email: normalizedEmail });
        console.error(`邮箱验证码发送失败: ${maskEmail(normalizedEmail)}`, error);
        throw new AppError('邮件发送失败，请稍后重试', 500);
    }
};

exports.verifyCode = async (email, code) => {
    const normalizedEmail = email.toLowerCase();
    const verificationCode = await VerificationCode.findOne({ email: normalizedEmail });

    if (!verificationCode) {
        throw new AppError('验证码不存在或已过期', 400);
    }

    if (verificationCode.code !== code) {
        throw new AppError('验证码错误', 400);
    }

    await VerificationCode.deleteOne({ _id: verificationCode._id });

    return true;
};
