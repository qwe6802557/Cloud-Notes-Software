const mongoose = require('mongoose');

const linkItemSchema = new mongoose.Schema({
    url: {
        type: String,
        required: true,
        trim: true
    },
    host: {
        type: String,
        default: '',
        trim: true
    }
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
    filename: {
        type: String,
        required: true,
        trim: true
    },
    originalName: {
        type: String,
        required: true,
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
        trim: true
    },
    size: {
        type: Number,
        required: true
    },
    mimetype: {
        type: String,
        default: 'application/octet-stream'
    },
    url: {
        type: String,
        required: true
    }
}, { _id: false });

const quickMemoSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '随心记必须关联用户'],
        index: true
    },
    kind: {
        type: String,
        enum: ['text', 'link', 'image', 'file'],
        required: true
    },
    content: {
        type: String,
        default: ''
    },
    links: {
        type: [linkItemSchema],
        default: []
    },
    attachment: {
        type: attachmentSchema,
        default: null
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
    // 客户端离线/弱网发送幂等键
    clientId: {
        type: String,
        default: null
    },
    convertedNoteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Note',
        default: null
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

// 时间线升序流、增量游标同步、分区统计与到期扫描索引（不建 TTL 索引，由清理引擎先删磁盘再标墓碑）
quickMemoSchema.index({ userId: 1, isDeleted: 1, createdAt: 1, _id: 1 });
quickMemoSchema.index({ userId: 1, isDeleted: 1, updatedAt: 1, _id: 1 });
quickMemoSchema.index({ userId: 1, storageType: 1, isDeleted: 1 });
quickMemoSchema.index({ userId: 1, storageType: 1, isDeleted: 1, 'attachment.folderName': 1 });
quickMemoSchema.index({ storageType: 1, isDeleted: 1, expireAt: 1 });
quickMemoSchema.index({ isDeleted: 1, deletedAt: 1 });
quickMemoSchema.index(
    { userId: 1, clientId: 1 },
    { unique: true, partialFilterExpression: { clientId: { $type: 'string' }, isDeleted: false } }
);

module.exports = mongoose.model('QuickMemo', quickMemoSchema);
