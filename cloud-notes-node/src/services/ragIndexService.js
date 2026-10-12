const Note = require('../models/Note');
const NoteChunk = require('../models/NoteChunk');
const { splitMarkdownIntoChunks } = require('./chunkService');
const { createEmbeddings } = require('./embedService');

/**
 * 针对单篇笔记执行增量分块与向量索引同步
 */
const indexSingleNote = async (noteId, user) => {
    const userId = user._id;
    const note = await Note.findOne({ _id: noteId, userId });

    if (!note || note.isDeleted) {
        await NoteChunk.deleteMany({ userId, noteId });
        return { chunkCount: 0 };
    }

    const chunks = splitMarkdownIntoChunks(note.content, note.title);
    if (chunks.length === 0) {
        await NoteChunk.deleteMany({ userId, noteId });
        return { chunkCount: 0 };
    }

    // 批量生成该篇切片的稠密向量
    const textsToEmbed = chunks.map(c => `[${c.headerPath}]\n${c.content}`);
    const embeddings = await createEmbeddings(textsToEmbed, user);

    const chunkDocs = chunks.map((c, idx) => ({
        userId,
        noteId: note._id,
        notebookId: note.notebookId || null,
        chunkIndex: c.chunkIndex,
        headerPath: c.headerPath,
        content: c.content,
        embedding: embeddings[idx] || [],
        tokenCount: Math.ceil(c.content.length / 2),
        hash: c.hash
    }));

    await NoteChunk.deleteMany({ userId, noteId });
    if (chunkDocs.length > 0) {
        await NoteChunk.insertMany(chunkDocs, { ordered: true });
    }

    return { chunkCount: chunkDocs.length };
};

/**
 * 清除指定笔记的所有切片索引
 */
const clearNoteIndex = async (noteId, userId) => {
    await NoteChunk.deleteMany({ userId, noteId });
};

/**
 * 获取当前用户的知识库切片与索引统计信息
 */
const getIndexStats = async userId => {
    const [totalNotes, distinctIndexedNotes, totalChunks] = await Promise.all([
        Note.countDocuments({ userId, isDeleted: false }),
        NoteChunk.distinct('noteId', { userId }),
        NoteChunk.countDocuments({ userId })
    ]);

    return {
        totalNotes,
        indexedNotes: distinctIndexedNotes.length,
        totalChunks
    };
};

/**
 * 全量重建/构建当前用户的知识库向量索引
 */
const reindexAllNotes = async user => {
    const userId = user._id;
    const notes = await Note.find({ userId, isDeleted: false })
        .select('_id title content notebookId')
        .lean();

    let totalChunks = 0;
    let indexedNotes = 0;

    for (const note of notes) {
        const chunks = splitMarkdownIntoChunks(note.content, note.title);
        if (chunks.length === 0) {
            await NoteChunk.deleteMany({ userId, noteId: note._id });
            continue;
        }

        const textsToEmbed = chunks.map(c => `[${c.headerPath}]\n${c.content}`);
        const embeddings = await createEmbeddings(textsToEmbed, user);

        const chunkDocs = chunks.map((c, idx) => ({
            userId,
            noteId: note._id,
            notebookId: note.notebookId || null,
            chunkIndex: c.chunkIndex,
            headerPath: c.headerPath,
            content: c.content,
            embedding: embeddings[idx] || [],
            tokenCount: Math.ceil(c.content.length / 2),
            hash: c.hash
        }));

        await NoteChunk.deleteMany({ userId, noteId: note._id });
        if (chunkDocs.length > 0) {
            await NoteChunk.insertMany(chunkDocs, { ordered: true });
            totalChunks += chunkDocs.length;
            indexedNotes++;
        }
    }

    return {
        totalNotes: notes.length,
        indexedNotes,
        totalChunks
    };
};

module.exports = {
    indexSingleNote,
    clearNoteIndex,
    getIndexStats,
    reindexAllNotes
};
