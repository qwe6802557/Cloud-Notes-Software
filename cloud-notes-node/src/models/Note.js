const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, '标题不能为空'],
        trim: true,
        maxlength: [200, '标题最多200个字符']
    },
    content: {
        type: String,
        default: ''
    },
    rawContent: {
        type: String
    },
    notebookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Notebook',
        required: [true, '笔记必须属于笔记本']
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '笔记必须关联用户']
    },
    type: {
        type: String,
        enum: ['note', 'folder'],
        default: 'note'
    },
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Note',
        default: null
    },
    tags: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tag'
    }],
    isEncrypted: {
        type: Boolean,
        default: false
    },
    encryptedData: {
        type: String,
        default: null
    },
    isStarred: {
        type: Boolean,
        default: false
    },
    isArchived: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date,
        default: null
    },
    order: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    lastOpenedAt: {
        type: Date,
        default: Date.now
    },
    outlinks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Note'
    }],
    unresolvedLinks: [{
        type: String,
        trim: true
    }],
    backlinkCount: {
        type: Number,
        default: 0
    },
    // 内容乐观锁版本号，仅正文/标题/加密载荷实质变动时递增
    contentVersion: {
        type: Number,
        default: 1
    },
    // 内容实质更新时间，与阅读时间 lastOpenedAt 隔离
    contentUpdatedAt: {
        type: Date,
        default: Date.now
    },
    // 客户端离线创建幂等键
    clientId: {
        type: String,
        default: null
    },
    // 标题与正文/密文 SHA-256 摘要，用于校验同步与镜像差异
    contentHash: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// 索引优化查询
noteSchema.index({ userId: 1, isDeleted: 1 });
noteSchema.index({ notebookId: 1, isDeleted: 1 });
noteSchema.index({ notebookId: 1, parentId: 1, isDeleted: 1 });
noteSchema.index({ notebookId: 1, parentId: 1, order: 1 });
noteSchema.index({ tags: 1 });
noteSchema.index({ userId: 1, outlinks: 1, isDeleted: 1 });
noteSchema.index({ userId: 1, unresolvedLinks: 1 });
noteSchema.index({ title: 'text', content: 'text' });
// 使用 partialFilterExpression 仅约束非空字符串 clientId，避免复合稀疏索引对 null 值报 E11000
noteSchema.index(
    { userId: 1, clientId: 1 },
    { unique: true, partialFilterExpression: { clientId: { $type: 'string' }, isDeleted: false } }
);
noteSchema.index({ userId: 1, updatedAt: 1, _id: 1 });

// 更新时间
noteSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: Date.now() });
    next();
});

const Note = mongoose.model('Note', noteSchema);

module.exports = Note;
