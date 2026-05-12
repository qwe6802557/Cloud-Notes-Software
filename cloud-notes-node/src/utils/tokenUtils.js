const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const config = require('../config');

// 生成JWT令牌
exports.generateToken = (id) => {
    return jwt.sign(
        { id },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
    );
};

// 验证JWT令牌
exports.verifyToken = async (token) => {
    return await promisify(jwt.verify)(token, config.jwtSecret);
};