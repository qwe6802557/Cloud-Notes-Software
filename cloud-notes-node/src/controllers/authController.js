const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const config = require('../config');

// 发送邮箱验证码
exports.sendVerificationCode = asyncHandler(async (req, res) => {
    const { email } = req.query;
    const result = await authService.sendVerificationCode(email);

    res.status(200).json({
        code: 200,
        message: '验证码已发送到邮箱',
        data: config.environment === 'development' ? { verifyCode: result } : {}
    });
});

// 用户注册
exports.register = asyncHandler(async (req, res) => {
    // 验证必填字段
    const { username, password, confirmPassword, email, verificationCode } = req.body;

    if (!username || !password || !confirmPassword || !email || !verificationCode) {
        throw new AppError('请填写所有必填字段', 400);
    }

    // 验证密码一致性
    if (password !== confirmPassword) {
        throw new AppError('两次输入的密码不一致', 400);
    }

    const result = await authService.register(req.body);

    res.status(200).json({
        code: 200,
        message: '注册成功',
        data: result
    });
});

// 用户登录 (修改为接收account字段)
exports.login = asyncHandler(async (req, res) => {
    const { account, password } = req.body;

    if (!account || !password) {
        throw new AppError('请提供账号和密码', 400);
    }

    const result = await authService.login(account, password);

    res.status(200).json({
        code: 200,
        message: '登录成功',
        data: result
    });
});

// 获取当前用户信息 (增加手机号字段)
exports.getCurrentUser = asyncHandler(async (req, res) => {
    res.status(200).json({
        code: 200,
        message: '获取当前用户信息成功',
        data: {
            user: {
                id: req.user._id,
                username: req.user.username,
                phone: req.user.phone,
                email: req.user.email,
                avatar: req.user.avatar,
                role: req.user.role,
                createdAt: req.user.createdAt
            }
        }
    });
});

// 更新当前用户
exports.updateCurrentUser = asyncHandler(async (req, res) => {
    const result = await authService.updateCurrentUser(req.user._id, req.body);

    res.status(200).json({
        code: 200,
        message: '更新用户信息成功',
        data: result
    });
});

// 退出登录保持不变
exports.logout = (req, res) => {
    res.status(200).json({
        code: 200,
        message: '退出登录成功',
        data: null
    });
};