const AppError = require('../utils/AppError');

// 开发环境错误响应
const sendErrorDev = (err, res) => {
    const errorResponse = {
        code: err.statusCode || 500,
        data: err.data || null,
        message: err.message,
        stack: err.stack
    };

    console.error('DETAILED_ERROR (Dev):\n', JSON.stringify(errorResponse, null, 2));
    res.status(errorResponse.code).json(errorResponse);
};

// 生产环境错误响应
const sendErrorProd = (err, res) => {
    if (err.isOperational) {
        res.status(err.statusCode).json({
            code: err.statusCode,
            data: err.data || null,
            message: err.message
        });
    } else {
        console.error('ERROR 💥', err);
        res.status(500).json({
            code: 500,
            data: null,
            message: '服务器内部错误'
        });
    }
};

// MongoDB错误处理
const handleCastErrorDB = err => {
    const message = `无效的${err.path}: ${err.value}`;
    return new AppError(message, 400);
};

const handleDuplicateFieldsDB = err => {
    const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
    const message = `字段值: ${value} 已存在。请使用其他值！`;
    return new AppError(message, 400);
};

const handleValidationErrorDB = err => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `无效输入数据。${errors.join('. ')}`;
    return new AppError(message, 400);
};

const handleJWTError = () => new AppError('无效的令牌，请重新登录', 401);
const handleJWTExpiredError = () => new AppError('令牌已过期，请重新登录', 401);

// 全局错误处理中间件
module.exports = (err, req, res, next) => {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        err.statusCode = 401;
        err.message = '登录状态已失效，请重新登录';
    }
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    if (process.env.NODE_ENV === 'production') {
        let error = { ...err };
        error.message = err.message;

        if (error.name === 'CastError') error = handleCastErrorDB(error);
        if (error.code === 11000) error = handleDuplicateFieldsDB(error);
        if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
        if (error.name === 'JsonWebTokenError') error = handleJWTError();
        if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();

        sendErrorProd(error, res);
    } else {
        sendErrorDev(err, res);
    }
};
