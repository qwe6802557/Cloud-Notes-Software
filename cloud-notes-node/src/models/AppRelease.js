const mongoose = require('mongoose');

const appReleaseSchema = new mongoose.Schema({
    platform: {
        type: String,
        enum: ['android', 'ios', 'all'],
        default: 'android',
        index: true
    },
    version: {
        type: String,
        required: [true, '版本号不能为空 (如 1.0.1)'],
        trim: true
    },
    buildNumber: {
        type: Number,
        required: [true, '构建序号 buildNumber 不能为空 (如 101)'],
        index: true
    },
    type: {
        type: String,
        enum: ['ota', 'native'],
        default: 'ota',
        required: true
    },
    forceUpdate: {
        type: Boolean,
        default: false
    },
    minCompatibleVersion: {
        type: String,
        default: '1.0.0',
        trim: true
    },
    title: {
        type: String,
        default: '发现新版本',
        trim: true
    },
    changelog: {
        type: String,
        default: '',
        trim: true
    },
    downloadUrl: {
        type: String,
        default: '',
        trim: true
    },
    hash: {
        type: String,
        default: '',
        trim: true
    },
    size: {
        type: Number,
        default: 0
    },
    apkUrl: {
        type: String,
        default: '',
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// 查询最新版本的复合索引
appReleaseSchema.index({ platform: 1, isActive: 1, buildNumber: -1 });

module.exports = mongoose.model('AppRelease', appReleaseSchema);
