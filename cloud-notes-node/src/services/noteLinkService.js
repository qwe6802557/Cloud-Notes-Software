const Note = require('../models/Note');

/**
 * 从笔记内容中提取所有 [[...]] 双链标题
 * 支持 [[笔记标题]] 与 [[笔记标题#具体段落]]
 */
const extractLinkTitles = content => {
    if (!content || typeof content !== 'string') return [];
    const regex = /\[\[([^[\]\n\r]+)\]\]/g;
    const titlesSet = new Set();
    let match;

    while ((match = regex.exec(content)) !== null) {
        const raw = match[1] || '';
        // 剥离可能存在的 #锚点
        const cleanTitle = raw.split('#')[0].trim();
        if (cleanTitle) {
            titlesSet.add(cleanTitle);
        }
    }

    return Array.from(titlesSet);
};

/**
 * 提取目标词汇在正文中的上下文语境摘要
 * 返回前 40~50 字符 + 目标词 + 后 40~50 字符
 */
const extractContextSnippet = (content, targetTitle, maxContextLen = 50) => {
    if (!content || !targetTitle) return '';
    const cleanContent = content.replace(/\r\n/g, '\n');
    const escaped = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 优先精确匹配 [[targetTitle...]]
    const bracketRegex = new RegExp(`\\[\\[${escaped}(?:#[^\\]]+)?\\]\\]`, 'i');
    let match = bracketRegex.exec(cleanContent);

    // 兜底：直接匹配 targetTitle
    if (!match) {
        const plainRegex = new RegExp(escaped, 'i');
        match = plainRegex.exec(cleanContent);
    }

    if (!match) {
        // 未直接命中返回前 100 字符作为概要
        return cleanContent.slice(0, 100).replace(/\n+/g, ' ').trim() + (cleanContent.length > 100 ? '...' : '');
    }

    const startIdx = match.index;
    const matchLen = match[0].length;
    const endIdx = startIdx + matchLen;

    const prefixStart = Math.max(0, startIdx - maxContextLen);
    const suffixEnd = Math.min(cleanContent.length, endIdx + maxContextLen);

    let prefix = cleanContent.slice(prefixStart, startIdx).replace(/\n+/g, ' ');
    let suffix = cleanContent.slice(endIdx, suffixEnd).replace(/\n+/g, ' ');
    const matchedText = match[0];

    if (prefixStart > 0) prefix = '...' + prefix;
    if (suffixEnd < cleanContent.length) suffix = suffix + '...';

    return `${prefix}${matchedText}${suffix}`.trim();
};

/**
 * 解析正文中的双向链接实体
 * 区分已存在的笔记 (outlinks) 与尚未创建的占位笔记 (unresolvedLinks)
 */
const resolveLinks = async (userId, currentNoteId, content) => {
    const titles = extractLinkTitles(content);
    if (titles.length === 0) {
        return {
            outlinkIds: [],
            unresolvedLinks: []
        };
    }

    // 批量查找符合标题且属于当前用户的活跃笔记
    const existingNotes = await Note.find({
        userId,
        isDeleted: false,
        type: 'note',
        title: { $in: titles }
    }).select('_id title');

    const titleToIdMap = new Map();
    existingNotes.forEach(n => {
        // 排除自己引用自己
        if (currentNoteId && n._id.toString() === currentNoteId.toString()) {
            return;
        }
        titleToIdMap.set(n.title.toLowerCase(), n._id);
    });

    const outlinkIds = [];
    const unresolvedLinks = [];

    titles.forEach(title => {
        const lower = title.toLowerCase();
        if (titleToIdMap.has(lower)) {
            outlinkIds.push(titleToIdMap.get(lower));
        } else {
            unresolvedLinks.push(title);
        }
    });

    return {
        outlinkIds,
        unresolvedLinks
    };
};

/**
 * 同步并维护笔记的双链关系与目标笔记的 backlinkCount 计数
 */
const syncNoteLinks = async (userId, noteId, content, oldOutlinkIds = []) => {
    const { outlinkIds, unresolvedLinks } = await resolveLinks(userId, noteId, content);

    const oldStrSet = new Set((oldOutlinkIds || []).map(id => id.toString()));
    const newStrSet = new Set((outlinkIds || []).map(id => id.toString()));

    // 计算新增与移除的外链
    const addedIds = outlinkIds.filter(id => !oldStrSet.has(id.toString()));
    const removedIds = (oldOutlinkIds || []).filter(id => !newStrSet.has(id.toString()));

    // 增量维护目标笔记的 backlinkCount
    if (addedIds.length > 0) {
        await Note.updateMany(
            { _id: { $in: addedIds }, userId },
            { $inc: { backlinkCount: 1 } }
        );
    }
    if (removedIds.length > 0) {
        await Note.updateMany(
            { _id: { $in: removedIds }, userId },
            { $inc: { backlinkCount: -1 } }
        );
    }

    return {
        outlinks: outlinkIds,
        unresolvedLinks
    };
};

/**
 * 笔记删除时清理出链的引用计数
 */
const handleNoteDeletion = async (userId, outlinkIds = []) => {
    if (outlinkIds && outlinkIds.length > 0) {
        await Note.updateMany(
            { _id: { $in: outlinkIds }, userId },
            { $inc: { backlinkCount: -1 } }
        );
    }
};

/**
 * 笔记恢复时补全出链的引用计数
 */
const handleNoteRestore = async (userId, outlinkIds = []) => {
    if (outlinkIds && outlinkIds.length > 0) {
        await Note.updateMany(
            { _id: { $in: outlinkIds }, userId },
            { $inc: { backlinkCount: 1 } }
        );
    }
};

/**
 * 当某篇笔记创建或重命名时，自动扫描并反向激活其他笔记中引用了该名称的 unresolvedLinks
 */
const resolveUnresolvedBacklinksOnTitleChange = async (userId, newNote) => {
    if (!newNote || !newNote.title) return;
    const title = newNote.title.trim();

    // 查找所有其 unresolvedLinks 包含此标题的笔记
    const referencingNotes = await Note.find({
        userId,
        isDeleted: false,
        type: 'note',
        _id: { $ne: newNote._id },
        unresolvedLinks: title
    });

    if (referencingNotes.length > 0) {
        for (const refNote of referencingNotes) {
            // 将 newNote._id 追加到 outlinks，并从 unresolvedLinks 移除
            const updatedOutlinks = [...(refNote.outlinks || []), newNote._id];
            const updatedUnresolved = (refNote.unresolvedLinks || []).filter(t => t !== title);

            await Note.updateOne(
                { _id: refNote._id },
                {
                    outlinks: updatedOutlinks,
                    unresolvedLinks: updatedUnresolved
                }
            );
        }

        // 一次性更新该新建笔记的 backlinkCount
        await Note.updateOne(
            { _id: newNote._id },
            { $inc: { backlinkCount: referencingNotes.length } }
        );
    }
};

/**
 * 获取指定笔记的全部反向链接 (Backlinks) 及上下文摘要
 */
const getBacklinksWithContext = async (userId, noteId) => {
    const currentNote = await Note.findOne({ _id: noteId, userId, isDeleted: false });
    if (!currentNote) return { backlinks: [], unresolvedBacklinks: [] };

    // 1. 正式已关联的反链 (outlinks 包含当前笔记 ID)
    const linkedNotes = await Note.find({
        userId,
        isDeleted: false,
        type: 'note',
        outlinks: noteId
    })
        .populate('notebookId', 'name color')
        .select('_id title content updatedAt notebookId');

    const backlinks = linkedNotes.map(sourceNote => ({
        _id: sourceNote._id,
        title: sourceNote.title,
        notebook: sourceNote.notebookId
            ? { _id: sourceNote.notebookId._id, name: sourceNote.notebookId.name, color: sourceNote.notebookId.color }
            : null,
        updatedAt: sourceNote.updatedAt,
        snippet: extractContextSnippet(sourceNote.content, currentNote.title)
    }));

    // 2. 占位文本提及反链 (unresolvedLinks 包含当前笔记标题)
    const mentioningNotes = await Note.find({
        userId,
        isDeleted: false,
        type: 'note',
        _id: { $ne: noteId },
        outlinks: { $ne: noteId },
        unresolvedLinks: currentNote.title
    })
        .populate('notebookId', 'name color')
        .select('_id title content updatedAt notebookId');

    const unresolvedBacklinks = mentioningNotes.map(sourceNote => ({
        _id: sourceNote._id,
        title: sourceNote.title,
        notebook: sourceNote.notebookId
            ? { _id: sourceNote.notebookId._id, name: sourceNote.notebookId.name, color: sourceNote.notebookId.color }
            : null,
        updatedAt: sourceNote.updatedAt,
        snippet: extractContextSnippet(sourceNote.content, currentNote.title)
    }));

    return {
        backlinks,
        unresolvedBacklinks
    };
};

/**
 * 生成全量或局部的力导向知识网络图谱数据 (Nodes & Edges)
 */
const getKnowledgeGraphData = async (userId, focusNoteId = null) => {
    const query = {
        userId,
        isDeleted: false,
        type: 'note'
    };

    const notes = await Note.find(query)
        .populate('notebookId', 'name color')
        .select('_id title notebookId outlinks backlinkCount updatedAt');

    const noteIdSet = new Set(notes.map(n => n._id.toString()));
    const notebookMap = new Map();

    const nodes = notes.map(n => {
        const nb = n.notebookId;
        if (nb && !notebookMap.has(nb._id.toString())) {
            notebookMap.set(nb._id.toString(), {
                id: nb._id.toString(),
                name: nb.name,
                color: nb.color || '#3b82f6'
            });
        }

        return {
            id: n._id.toString(),
            title: n.title,
            notebookId: nb ? nb._id.toString() : 'default',
            notebookName: nb ? nb.name : '默认笔记本',
            notebookColor: nb?.color || '#3b82f6',
            backlinkCount: n.backlinkCount || 0,
            outlinkCount: (n.outlinks || []).length,
            totalDegree: (n.backlinkCount || 0) + ((n.outlinks || []).length),
            updatedAt: n.updatedAt
        };
    });

    const links = [];
    const linkSet = new Set();

    notes.forEach(sourceNote => {
        const sourceId = sourceNote._id.toString();
        (sourceNote.outlinks || []).forEach(targetIdObj => {
            const targetId = targetIdObj.toString();
            // 确保 target 属于当前用户的有效活跃笔记
            if (noteIdSet.has(targetId) && sourceId !== targetId) {
                const pairKey = `${sourceId}->${targetId}`;
                if (!linkSet.has(pairKey)) {
                    linkSet.add(pairKey);
                    links.push({
                        source: sourceId,
                        target: targetId
                    });
                }
            }
        });
    });

    // 若指定了 focusNoteId，提取 1~2 级局部子图
    if (focusNoteId && noteIdSet.has(focusNoteId.toString())) {
        const targetFocus = focusNoteId.toString();
        const neighborSet = new Set([targetFocus]);

        // 查找 1 级邻居
        links.forEach(l => {
            if (l.source === targetFocus) neighborSet.add(l.target);
            if (l.target === targetFocus) neighborSet.add(l.source);
        });

        const localNodes = nodes.filter(n => neighborSet.has(n.id));
        const localLinks = links.filter(l => neighborSet.has(l.source) && neighborSet.has(l.target));

        return {
            nodes: localNodes,
            links: localLinks,
            notebooks: Array.from(notebookMap.values()),
            isLocal: true,
            focusId: targetFocus
        };
    }

    return {
        nodes,
        links,
        notebooks: Array.from(notebookMap.values()),
        isLocal: false
    };
};

module.exports = {
    extractLinkTitles,
    extractContextSnippet,
    resolveLinks,
    syncNoteLinks,
    handleNoteDeletion,
    handleNoteRestore,
    resolveUnresolvedBacklinksOnTitleChange,
    getBacklinksWithContext,
    getKnowledgeGraphData
};
