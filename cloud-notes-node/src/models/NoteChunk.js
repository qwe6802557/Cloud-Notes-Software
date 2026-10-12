const mongoose = require('mongoose');

const noteChunkSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        noteId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Note',
            required: true,
            index: true
        },
        notebookId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Notebook',
            default: null,
            index: true
        },
        chunkIndex: {
            type: Number,
            required: true
        },
        headerPath: {
            type: String,
            default: ''
        },
        content: {
            type: String,
            required: true
        },
        embedding: {
            type: [Number],
            required: true,
            select: true
        },
        tokenCount: {
            type: Number,
            default: 0
        },
        hash: {
            type: String,
            required: true
        }
    },
    {
        timestamps: true
    }
);

noteChunkSchema.index({ userId: 1, noteId: 1, chunkIndex: 1 }, { unique: true });
noteChunkSchema.index({ userId: 1, notebookId: 1 });
noteChunkSchema.index({ content: 'text', headerPath: 'text' }, { default_language: 'none' });

module.exports = mongoose.model('NoteChunk', noteChunkSchema);
