const morgan = require('morgan');
// Morgan 是一个Node.js HTTP 请求日志中间件，专门用于记录 HTTP 请求的详细信息。它可以记录请求的方法、URL、状态码、响应时间等信息。
const config = require('../config');

// 根据应用程序的环境变量来决定使用哪种日志格式
// 'dev' 格式：简洁的彩色输出，专为开发环境设计，包含请求方法、URL、状态码、响应时间等，便于开发调试  适合开发环境
// 'combined' 格式：更详细的标准 Apache 组合日志格式，适合生产环境，包含更多信息如 IP 地址、时间戳等 适合生产环境
const stream = process.stdout; // 默认将日志输出到控制台
const format = config.environment === 'development' ? 'dev' : 'combined';

// 创建 morgan 中间件实例
const loggerMiddleware = morgan(format, { stream });

module.exports = loggerMiddleware;
