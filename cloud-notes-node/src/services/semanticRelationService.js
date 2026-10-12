const NoteChunk = require('../models/NoteChunk');
const Note = require('../models/Note');
const { cosineSimilarity } = require('./embedService');

const CACHE_TTL_MS = 10 * 60 * 1000;
const relatedCache = new Map();
const graphCache = new Map();

/**
 * 清除指定用户的语义缓存
 * @param {string} userId 
 */
const invalidateUserSemanticCache = userId => {
    const uId = String(userId);
    for (const key of relatedCache.keys()) {
        if (key.startsWith(uId)) relatedCache.delete(key);
    }
    graphCache.delete(uId);
};

/**
 * 获取与指定笔记语义关联度最高的笔记列表
 * @param {object} params
 * @param {string} params.noteId 当前笔记ID
 * @param {object} params.user 当前用户对象
 * @param {number} [params.topK=5] 返回数量
 * @param {number} [params.minScore=0.55] 最低匹配阈值
 * @returns {Promise<Array>} 语义推荐笔记列表
 */
const getRelatedNotesForNote = async ({ noteId, user, topK = 5, minScore = 0.55 }) => {
    const userId = user._id;
    const cacheKey = `${userId}_${noteId}_${topK}_${minScore}`;
    const cached = relatedCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }

    const currentChunks = await NoteChunk.find({ userId, noteId })
        .select('embedding headerPath content')
        .lean();

    if (!currentChunks || currentChunks.length === 0) {
        return [];
    }

    const candidateChunks = await NoteChunk.find({
        userId,
        noteId: { $ne: noteId }
    })
        .select('noteId notebookId headerPath content embedding')
        .lean();

    if (!candidateChunks || candidateChunks.length === 0) {
        return [];
    }

    // 筛选当前笔记的前 5 个核心切片作为比对代表
    const sourceVectors = currentChunks.slice(0, 5).map(c => c.embedding).filter(v => v && v.length > 0);
    if (sourceVectors.length === 0) return [];

    // Max-Pooling 归集各外部笔记的最大相似度及最佳匹配切片
    const noteMaxScoreMap = new Map();

    for (const cand of candidateChunks) {
        if (!cand.embedding || cand.embedding.length === 0) continue;
        const targetId = String(cand.noteId);

        let maxSim = 0;
        for (const sVec of sourceVectors) {
            const sim = cosineSimilarity(sVec, cand.embedding);
            if (sim > maxSim) maxSim = sim;
        }

        if (maxSim >= minScore) {
            const existing = noteMaxScoreMap.get(targetId);
            if (!existing || maxSim > existing.similarity) {
                noteMaxScoreMap.set(targetId, {
                    noteId: targetId,
                    notebookId: cand.notebookId,
                    similarity: maxSim,
                    headerPath: cand.headerPath || '',
                    snippet: (cand.content || '').replace(/\s+/g, ' ').slice(0, 150)
                });
            }
        }
    }

    if (noteMaxScoreMap.size === 0) {
        relatedCache.set(cacheKey, { timestamp: Date.now(), data: [] });
        return [];
    }

    const sortedCandidates = Array.from(noteMaxScoreMap.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);

    const targetNoteIds = sortedCandidates.map(c => c.noteId);
    const targetNotes = await Note.find({ _id: { $in: targetNoteIds }, isDeleted: false })
        .select('_id title notebookId updatedAt')
        .populate('notebookId', 'name')
        .lean();

    const noteMetaMap = new Map(targetNotes.map(n => [String(n._id), n]));

    const result = sortedCandidates
        .filter(c => noteMetaMap.has(c.noteId))
        .map(c => {
            const meta = noteMetaMap.get(c.noteId);
            return {
                noteId: c.noteId,
                title: meta.title || '无标题笔记',
                notebookName: meta.notebookId?.name || '默认笔记本',
                similarity: Number(c.similarity.toFixed(3)),
                headerPath: c.headerPath,
                snippet: c.snippet,
                updatedAt: meta.updatedAt
            };
        });

    relatedCache.set(cacheKey, { timestamp: Date.now(), data: result });
    return result;
};

/**
 * 聚合全库笔记之间的语义强关联边，供给力导向知识图谱渲染
 * @param {object} params
 * @param {object} params.user 当前用户对象
 * @param {number} [params.threshold=0.65] 相似度阈值
 * @returns {Promise<Array>} 语义连线列表 [{ source, target, similarity }]
 */
const getSemanticGraphEdges = async ({ user, threshold = 0.65 }) => {
    const userId = user._id;
    const cacheKey = `${userId}_${threshold}`;
    const cached = graphCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }

    const allChunks = await NoteChunk.find({ userId })
        .select('noteId embedding')
        .lean();

    if (!allChunks || allChunks.length === 0) {
        return [];
    }

    // 按笔记归集核心切片向量（每篇取前 2 个代表性切片）
    const noteVectorsMap = new Map();
    for (const chunk of allChunks) {
        if (!chunk.embedding || chunk.embedding.length === 0) continue;
        const nId = String(chunk.noteId);
        if (!noteVectorsMap.has(nId)) {
            noteVectorsMap.set(nId, []);
        }
        const vecs = noteVectorsMap.get(nId);
        if (vecs.length < 2) {
            vecs.push(chunk.embedding);
        }
    }

    const noteIds = Array.from(noteVectorsMap.keys());
    const edges = [];

    // 双重循环比对两两笔记的最大相似度
    for (let i = 0; i < noteIds.length; i++) {
        const idA = noteIds[i];
        const vecsA = noteVectorsMap.get(idA);

        for (let j = i + 1; j < noteIds.length; j++) {
            const idB = noteIds[j];
            const vecsB = noteVectorsMap.get(idB);

            let maxSim = 0;
            for (const vA of vecsA) {
                for (const vB of vecsB) {
                    const sim = cosineSimilarity(vA, vB);
                    if (sim > maxSim) maxSim = sim;
                }
            }

            if (maxSim >= threshold) {
                edges.push({
                    source: idA,
                    target: idB,
                    similarity: Number(maxSim.toFixed(3))
                });
            }
        }
    }

    graphCache.set(cacheKey, { timestamp: Date.now(), data: edges });
    return edges;
};

module.exports = {
    getRelatedNotesForNote,
    getSemanticGraphEdges,
    invalidateUserSemanticCache
};
