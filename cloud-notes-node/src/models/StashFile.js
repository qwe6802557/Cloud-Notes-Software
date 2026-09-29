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
    }
}, {
    timestamps: true
});

// TTL 索引：仅针对有 expireAt 值的临时文件，MongoDB 自动清理过期文档（expireAfterSeconds: 0）
stashFileSchema.index(
    { expireAt: 1 },
    {
        expireAfterSeconds: 0,
        partialFilterExpression: { expireAt: { $type: 'date' } }
    }
);

// 组合索引提高特定用户下的分区查询性能
stashFileSchema.index({ userId: 1, storageType: 1, createdAt: -1 });

module.exports = mongoose.model('StashFile', stashFileSchema);
