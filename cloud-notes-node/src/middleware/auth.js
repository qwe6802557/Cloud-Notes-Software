const { verifyToken } = require('../utils/tokenUtils');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// 验证用户是否已登录
exports.protect = asyncHandler(async (req, res, next) => {
    // 1) 获取token
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return next(new AppError('请先登录以获取访问权限', 401));
    }

    // 2) 验证token
    const decoded = await verifyToken(token);

    // 3) 检查用户是否存在
    const currentUser = await User.findById(decoded.id);
    if (!currentUser) {
        return next(new AppError('此令牌的用户不再存在', 401));
    }

    // 4) 将用户信息附加到请求对象
    req.user = currentUser;
    next();
});

// 限制角色权限
exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return next(new AppError('您没有权限执行此操作', 403));
        }
        next();
    };
};

// 检查资源所有权
exports.checkOwnership = (model) => asyncHandler(async (req, res, next) => {
    const resourceId = req.params.id;
    const userId = req.user._id;

    const resource = await model.findById(resourceId);

    if (!resource) {
        return next(new AppError('未找到指定资源', 404));
    }

    // 检查资源是否属于当前用户
    if (resource.userId.toString() !== userId.toString()) {
        return next(new AppError('您没有权限访问此资源', 403));
    }

    req.resource = resource;
    next();
});