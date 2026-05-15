const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const routes = require('./routes/index');
const errorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/AppError');
const connectDB = require('./config/db');
const loggerMiddleware = require('./middleware/logger');
const session = require('express-session');

// 连接数据库
connectDB();

// 创建Express应用
const app = express();
app.set('trust proxy', config.trustProxy);

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || config.cors.allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new AppError('当前来源不允许访问接口', 403));
    },
    credentials: true
};

// 中间件
app.use(cors(corsOptions)); // 跨域中间件配置
app.use(helmet({
    crossOriginResourcePolicy: {
        policy: 'cross-origin'
    }
}));
// 通过设置各种HTTP头来帮助保护应用免受一些常见的Web漏洞
app.use(loggerMiddleware); // 日志中间件
app.use(express.json({ limit: config.uploads.maxSize }));
app.use(express.urlencoded({ extended: true, limit: config.uploads.maxSize }));

// 注册session
app.use(session({
    secret: config.sessionKey,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: config.environment === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.use('/uploads', express.static(config.uploads.path));
// config.uploads.path 已统一解析为绝对路径，生产环境应指向应用目录外的持久化目录

// API路由
app.use('/', routes);

// 处理未匹配路由
app.use((req, res, next) => {
    next(new AppError(`找不到路径: ${req.originalUrl}`, 404));
});

// 错误处理中间件
app.use(errorHandler);

// 启动服务器
const PORT = config.port;
app.listen(PORT, () => {
    console.log(`服务器已启动 访问地址: http://localhost:${PORT}`);
    console.log(`环境: ${config.environment}`);
});

// 处理未捕获的异常
process.on('uncaughtException', err => {
    console.error('未捕获的异常! 💥 关闭服务...');
    console.error(err.name, err.message);
    process.exit(1);
});

// 处理未处理的Promise拒绝
process.on('unhandledRejection', err => {
    console.error('未处理的Promise拒绝! 💥 关闭服务...');
    console.error(err.name, err.message);
    process.exit(1);
});

module.exports = app;
