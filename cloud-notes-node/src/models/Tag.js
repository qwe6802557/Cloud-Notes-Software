const mongoose = require('mongoose');

const tagSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, '标签名不能为空'],
        trim: true,
        maxlength: [50, '标签名最多50个字符']
    },
    color: {
        type: String,
        default: '#1890ff'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '标签必须关联用户']
    },
    count: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// 索引优化查询
tagSchema.index({ userId: 1, name: 1 }, { unique: true });

const Tag = mongoose.model('Tag', tagSchema);

module.exports = Tag;