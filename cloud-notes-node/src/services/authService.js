const User = require('../models/User');
const Notebook = require('../models/Notebook');
const AppError = require('../utils/AppError');
const { generateToken } = require('../utils/tokenUtils');
const emailService = require('./emailService');

const formatUser = user => ({
    id: user._id,
    username: user.username,
    phone: user.phone,
    email: user.email,
    avatar: user.avatar,
    role: user.role,
    createdAt: user.createdAt
});

// 用户注册
exports.register = async (userData) => {
    // 检查邮箱是否已存在
    const existingUserByEmail = await User.findOne({ email: userData.email });
    if (existingUserByEmail) {
        throw new AppError('该邮箱已注册', 400);
    }

    // 验证邮箱验证码
    await emailService.verifyCode(userData.email, userData.verificationCode);

    // 创建用户
    const createUserData = {
        username: userData.username,
        email: userData.email,
        password: userData.password
    };
    if (userData.phone) {
        createUserData.phone = userData.phone;
    }

    const newUser = await User.create(createUserData);

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
        user: formatUser(newUser)
    };
};

// 发送验证码
exports.sendVerificationCode = async (email) => {
    return await emailService.sendVerificationCode(email);
};

// 用户登录
exports.login = async (account, password) => {
    const user = await User.findOne({ email: account.toLowerCase() }).select('+password');
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
        user: formatUser(user)
    };
};

exports.updateCurrentUser = async (userId, updateData) => {
    const user = await User.findById(userId).select('+password');
    if (!user) {
        throw new AppError('用户不存在', 404);
    }

    const { username, avatar, password } = updateData;

    if (username !== undefined) {
        user.username = username.trim();
    }

    if (avatar !== undefined) {
        user.avatar = avatar || 'default-avatar.png';
    }

    if (password) {
        user.password = password;
    }

    await user.save();

    return {
        user: formatUser(user)
    };
};