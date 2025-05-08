const mongoose = require('mongoose');

const notebookSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, '笔记本名称不能为空'],
        trim: true,
        maxlength: [100, '笔记本名称最多100个字符']
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, '描述最多500个字符']
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '笔记本必须关联用户']
    },
    cover: {
        type: String,
        default: 'default-notebook.png'
    },
    isDefault: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    sort: {
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
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// 虚拟属性: 获取笔记本中的所有笔记
notebookSchema.virtual('notes', {
    ref: 'Note',
    localField: '_id',
    foreignField: 'notebookId'
});

// 索引优化查询
notebookSchema.index({ userId: 1, isDeleted: 1 });
notebookSchema.index({ userId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

// 更新时间
notebookSchema.pre('findOneAndUpdate', function(next) {
    this.set({ updatedAt: Date.now() });
    next();
});

const Notebook = mongoose.model('Notebook', notebookSchema);

module.exports = Notebook;