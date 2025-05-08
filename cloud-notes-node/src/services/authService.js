const User = require('../models/User');
const Notebook = require('../models/Notebook');
const AppError = require('../utils/AppError');
const { generateToken } = require('../utils/tokenUtils');
const smsService = require('./smsService');

// 用户注册
exports.register = async (userData) => {
    // 检查手机号是否已存在
    const existingUserByPhone = await User.findOne({ phone: userData.phone });
    if (existingUserByPhone) {
        throw new AppError('该手机号已注册', 400);
    }

    // 检查邮箱是否已存在
    if (userData.email) {
        const existingUserByEmail = await User.findOne({ email: userData.email });
        if (existingUserByEmail) {
            throw new AppError('该邮箱已注册', 400);
        }
    }

    // 验证短信验证码
    await smsService.verifyCode(userData.phone, userData.verificationCode);

    // 创建用户
    const newUser = await User.create({
        username: userData.username,
        email: userData.email || null, // 邮箱可选
        phone: userData.phone, // 手机号必填
        password: userData.password
    });

    // 创建默认笔记本
    await Notebook.create({
        name: '默认笔记本',
        userId: newUser._id,
        isDefault: true
    });

    // 生成JWT
    const token = generateToken(newUser._id);

    return {
        token,
        user: {
            id: newUser._id,
            username: newUser.username,
            phone: newUser.phone,
            email: newUser.email
        }
    };
};

// 发送验证码
exports.sendVerificationCode = async (phone) => {
    // 检查手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        throw new AppError('请输入有效的手机号', 400);
    }

    return await smsService.sendVerificationCode(phone);
};

// 用户登录 (修改为支持手机号或邮箱登录)
exports.login = async (account, password) => {
    // 检查用户是否存在 (支持手机号或邮箱登录)
    const isEmail = /^\S+@\S+\.\S+$/.test(account);
    const searchQuery = isEmail ? { email: account } : { phone: account };

    const user = await User.findOne(searchQuery).select('+password');
    if (!user) {
        throw new AppError('账号或密码不正确', 401);
    }

    // 检查密码是否正确
    const isPasswordCorrect = await user.comparePassword(password);
    if (!isPasswordCorrect) {
        throw new AppError('账号或密码不正确', 401);
    }

    // 生成JWT
    const token = generateToken(user._id);

    return {
        token,
        user: {
            id: user._id,
            username: user.username,
            phone: user.phone,
            email: user.email
        }
    };
};