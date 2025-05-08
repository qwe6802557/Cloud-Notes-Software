// 验证码
const mongoose = require('mongoose');

const verificationCodeSchema = new mongoose.Schema({
    phone: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        // 5分钟后自动过期
        expires: 300
    }
});

const VerificationCode = mongoose.model('VerificationCode', verificationCodeSchema);

module.exports = VerificationCode;