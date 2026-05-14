const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
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

// 中间件
app.use(cors()); // 跨域中间件配置
app.use(helmet({
    crossOriginResourcePolicy: {
        policy: 'cross-origin'
    }
}));
// 通过设置各种HTTP头来帮助保护应用免受一些常见的Web漏洞：
// 安全增强：自动设置多种HTTP安全相关的响应头
// 主要防护功能：
// 防止跨站脚本攻击(XSS)
// 防止点击劫持(Clickjacking)
// 防止MIME类型嗅探攻击
// 阻止X-Powered-By头泄露服务器信息
// 实施内容安全策略(CSP)
// 设置严格传输安全(HSTS)
// 默认行为：无需配置即可获得基本安全保护，适合大多数Web应用
// Helmet是Express应用的安全最佳实践，通过一行代码即可显著提高应用的安全性，减少常见安全漏洞的风险。
app.use(loggerMiddleware); // 日志中间件
app.use(express.json({ limit: config.uploads.maxSize }));
// 启用JSON解析中间件，处理Content-Type为application/json的请求
// limit使用上传配置限制请求体大小，超过此限制的请求会被拒绝
// 解析后的JSON数据会存储在req.body对象中
app.use(express.urlencoded({ extended: true, limit: config.uploads.maxSize }));
//启用URL编码解析中间件，处理Content-Type为application/x-www-form-urlencoded的请求
// extended: true允许解析复杂对象，使用qs库而非querystring
// limit同样使用上传配置限制请求体大小
// 解析后的表单数据会存储在req.body对象中

// 以上两个中间件对保护服务器免受过大请求的攻击很重要，同时也便于在路由处理程序中访问客户端提交的数据

app.use('/uploads', express.static(path.join(__dirname, '..', config.uploads.path)));
// 提供静态文件服务：使用Express的内置中间件express.static来提供静态文件访问
// URL路径映射：将URL路径/uploads映射到服务器上的实际文件目录
// 文件路径构建：
// __dirname：当前脚本所在目录的绝对路径
// ..：向上一级目录
// config.uploads.path：从配置文件中获取的上传文件存储路径
// 实际效果：当用户访问http://localhost:3001/uploads/some-file.jpg时，服务器会返回存储在[项目根目录]/uploads/some-file.jpg的文件（假设config.uploads.path配置为'uploads/'）
// 这种设置使得上传到服务器的文件（如图片、文档等）可以通过HTTP请求直接访问，非常适合实现文件上传和访问功能。

// API路由
app.use('/', routes);

// 处理未匹配路由
app.use((req, res, next) => {
    next(new AppError(`找不到路径: ${req.originalUrl}`, 404));
});

// 错误处理中间件
app.use(errorHandler);
// 注册session
app.use(session({
    secret: config.sessionKey,
    resave: false,
    saveUninitialized: true,
    // cookie: { secure: process.env.NODE_ENV === 'production' } // 在生产环境中是否使用 HTTPS
}));

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
