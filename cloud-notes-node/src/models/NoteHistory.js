const mongoose = require('mongoose');

const noteHistorySchema = new mongoose.Schema({
    noteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Note',
        required: [true, '历史记录必须关联笔记'],
        index: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, '历史记录必须关联用户'],
        index: true
    },
    title: {
        type: String,
        default: ''
    },
    content: {
        type: String,
        default: ''
    },
    saveType: {
        type: String,
        enum: ['manual', 'auto', 'rollback'],
        default: 'manual'
    },
    wordCount: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: false
});

noteHistorySchema.index({ noteId: 1, createdAt: -1 });

const NoteHistory = mongoose.model('NoteHistory', noteHistorySchema);

module.exports = NoteHistory;
