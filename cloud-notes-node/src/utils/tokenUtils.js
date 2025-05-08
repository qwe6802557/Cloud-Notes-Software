const jwt = require('jsonwebtoken');
const { promisify } = require('util');

// 生成JWT令牌
exports.generateToken = (id) => {
    return jwt.sign(
        { id },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

// 验证JWT令牌
exports.verifyToken = async (token) => {
    return await promisify(jwt.verify)(token, process.env.JWT_SECRET);
};