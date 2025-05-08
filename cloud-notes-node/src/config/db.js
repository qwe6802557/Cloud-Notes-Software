const mongoose = require('mongoose');
const config = require('./index');

// MongoDB连接选项
const mongoOptions = {
    useNewUrlParser: true,    // 告知 Mongoose 使用新的 URL 解析器，旧的已弃用
    useUnifiedTopology: true,  // 告知 Mongoose 使用新的服务器发现和监控引擎，以获得更好的稳定性和性能
    maxPoolSize: 10,           // 连接池最大连接数
    connectTimeoutMS: 10000,   // 连接超时时间
    retryWrites: true          // 重试写入操作
};

// 连接MongoDB
const connectDB = async () => {
    try {
        const conn = await mongoose.connect(config.mongoURI, mongoOptions);
        console.log(`MongoDB连接成功: 主机:${conn.connection.host + ' 端口:' + conn.connection.port}`);

        // 监听连接事件
        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB连接已断开，尝试重连...');
            setTimeout(connectDB, 5000); // 5秒后重试连接
        });

        mongoose.connection.on('error', (err) => {
            console.error(`MongoDB连接错误: ${err.message}`);
            setTimeout(connectDB, 5000);
        });

        // 关闭连接
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log('MongoDB连接已关闭');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        console.error(`MongoDB连接失败: ${error.message}`);

        // 非生产环境直接退出，生产环境尝试重连
        if (config.environment === 'production') {
            console.log('5秒后尝试重新连接...');
            setTimeout(connectDB, 5000);
        } else {
            process.exit(1);
        }
    }
};

module.exports = connectDB;