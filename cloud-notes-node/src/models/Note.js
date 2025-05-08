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
        required: [true, '内容不能为空']
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
    tags: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Tag'
    }],
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
    }
}, {
    timestamps: true
});

// 索引优化查询
noteSchema.index({ userId: 1, isDeleted: 1 });
noteSchema.index({ notebookId: 1, isDeleted: 1 });
noteSchema.index({ tags: 1 });
noteSchema.index({ title: 'text', content: 'text' });

// 更新时间
noteSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: Date.now() });
    next();
});

const Note = mongoose.model('Note', noteSchema);

module.exports = Note;