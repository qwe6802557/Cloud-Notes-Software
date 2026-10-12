const NoteChunk = require('../models/NoteChunk');
const Note = require('../models/Note');
const { createEmbeddings, cosineSimilarity } = require('./embedService');

const RRF_K = 60;
const DENSE_WEIGHT = 0.65;
const SPARSE_WEIGHT = 0.35;
const MAX_CONTEXT_CHUNKS = 5;

/**
 * 执行向量语义相似度 + 关键词全文双路召回并经由 RRF 融合重排
 * @param {object} params
 * @param {string} params.query 用户提问问题
 * @param {object} params.user 当前用户
 * @param {object} [params.scope] 检索范围 { notebookId, noteId }
 * @returns {Promise<Array>} 最终入选的最佳知识切片及元信息
 */
const searchHybridKnowledge = async ({ query, user, scope = {} }) => {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) return [];

    const userId = user._id;

    const baseFilter = { userId };
    if (scope.notebookId) {
        baseFilter.notebookId = scope.notebookId;
    }
    if (scope.noteId) {
        baseFilter.noteId = scope.noteId;
    }

    const queryEmbeddings = await createEmbeddings([cleanQuery], user);
    const queryVector = queryEmbeddings[0] || [];

    const candidateChunks = await NoteChunk.find(baseFilter)
        .select('noteId notebookId chunkIndex headerPath content embedding')
        .lean();

    if (candidateChunks.length === 0) {
        return [];
    }

    // 1. 语义向量相似度路 (Dense)
    const denseRanked = [];
    if (queryVector.length > 0) {
        for (const chunk of candidateChunks) {
            const similarity = cosineSimilarity(queryVector, chunk.embedding);
            denseRanked.push({
                chunk,
                similarity
            });
        }
        denseRanked.sort((a, b) => b.similarity - a.similarity);
    }

    // 2. 关键词精准匹配路 (Sparse)
    const keywords = cleanQuery.split(/\s+/).filter(w => w.length > 1);
    const sparseRanked = [];

    for (const chunk of candidateChunks) {
        let score = 0;
        const text = `${chunk.headerPath} ${chunk.content}`.toLowerCase();
        for (const kw of keywords) {
            const lowerKw = kw.toLowerCase();
            const count = (text.match(new RegExp(lowerKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            if (count > 0) {
                score += count * 2;
            }
        }
        if (score > 0) {
            sparseRanked.push({
                chunk,
                score
            });
        }
    }
    sparseRanked.sort((a, b) => b.score - a.score);

    // 3. RRF 倒数排名融合评分
    const rrfScores = new Map();

    denseRanked.slice(0, 15).forEach((item, index) => {
        const id = String(item.chunk._id);
        const score = DENSE_WEIGHT / (RRF_K + index + 1);
        rrfScores.set(id, {
            chunk: item.chunk,
            similarity: item.similarity,
            rrf: (rrfScores.get(id)?.rrf || 0) + score
        });
    });

    sparseRanked.slice(0, 15).forEach((item, index) => {
        const id = String(item.chunk._id);
        const score = SPARSE_WEIGHT / (RRF_K + index + 1);
        const existing = rrfScores.get(id);
        if (existing) {
            existing.rrf += score;
        } else {
            rrfScores.set(id, {
                chunk: item.chunk,
                similarity: 0,
                rrf: score
            });
        }
    });

    const fusedList = Array.from(rrfScores.values())
        .sort((a, b) => b.rrf - a.rrf)
        .slice(0, MAX_CONTEXT_CHUNKS);

    if (fusedList.length === 0) {
        return [];
    }

    const noteIds = [...new Set(fusedList.map(item => item.chunk.noteId))];
    const notes = await Note.find({ _id: { $in: noteIds } })
        .select('_id title notebookId')
        .populate('notebookId', 'name')
        .lean();

    const noteMap = new Map(notes.map(n => [String(n._id), n]));

    return fusedList.map((item, idx) => {
        const note = noteMap.get(String(item.chunk.noteId));
        return {
            citationIndex: idx + 1,
            chunkId: item.chunk._id,
            noteId: item.chunk.noteId,
            noteTitle: note?.title || '未命名笔记',
            notebookName: note?.notebookId?.name || '默认笔记本',
            headerPath: item.chunk.headerPath,
            content: item.chunk.content,
            similarity: Number(item.similarity.toFixed(4)),
            score: Number(item.rrf.toFixed(6))
        };
    });
};

module.exports = {
    searchHybridKnowledge
};
