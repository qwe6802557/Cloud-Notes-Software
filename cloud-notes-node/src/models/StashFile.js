const mongoose = require('mongoose');

const stashFileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '文件必须关联用户'],
        index: true
    },
    filename: {
        type: String,
        required: [true, '文件名不能为空'],
        trim: true
    },
    originalName: {
        type: String,
        required: [true, '原始文件名不能为空'],
        trim: true
    },
    relativePath: {
        type: String,
        default: '',
        trim: true
    },
    folderName: {
        type: String,
        default: '',
        trim: true,
        index: true
    },
    size: {
        type: Number,
        required: [true, '文件大小不能为空']
    },
    mimetype: {
        type: String,
        default: 'application/octet-stream'
    },
    storageType: {
        type: String,
        enum: ['temp', 'permanent'],
        default: 'temp',
        index: true
    },
    expireAt: {
        type: Date,
        default: null
    },
    url: {
        type: String,
        required: true
    },
    convertedNoteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Note',
        default: null
    }
}, {
    timestamps: true
});

// 统一由服务端清理引擎先删磁盘再删库，禁止 MongoDB TTL 私自删记录引发孤儿文件泄漏
stashFileSchema.index({ storageType: 1, expireAt: 1 });

// 组合索引提高特定用户下的分区查询性能
stashFileSchema.index({ userId: 1, storageType: 1, createdAt: -1 });
stashFileSchema.index({ userId: 1, storageType: 1, folderName: 1, createdAt: -1 });

module.exports = mongoose.model('StashFile', stashFileSchema);
