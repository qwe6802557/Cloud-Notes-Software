const Note = require('../models/Note');
const Tag = require('../models/Tag');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const buildKeywordFilter = keyword => {
    const value = (keyword || '').trim();
    if (!value) {
        return null;
    }
    const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return {
        $or: [
            { title: { $regex: escapedValue, $options: 'i' } },
            { content: { $regex: escapedValue, $options: 'i' } }
        ]
    };
};

// 辅助：根据节点数组构建树形结构
const buildNodeTree = items => {
    const itemMap = new Map();
    const rootNodes = [];

    items.forEach(item => {
        const itemObj = item.toObject ? item.toObject() : item;
        itemMap.set(itemObj._id.toString(), {
            ...itemObj,
            key: itemObj._id.toString(),
            children: []
        });
    });

    items.forEach(item => {
        const id = item._id.toString();
        const node = itemMap.get(id);
        const pId = item.parentId ? item.parentId.toString() : null;

        if (pId && itemMap.has(pId)) {
            itemMap.get(pId).children.push(node);
        } else {
            rootNodes.push(node);
        }
    });

    return rootNodes;
};

// 辅助：递归查找指定父级下的所有子孙节点 ID
const findDescendantIds = async (parentIds, userId, queryDeleted = false) => {
    let allIds = [...parentIds];
    let currentParents = [...parentIds];

    while (currentParents.length > 0) {
        const children = await Note.find({
            parentId: { $in: currentParents },
            userId,
            isDeleted: queryDeleted
        }).select('_id');

        if (children.length === 0) {
            break;
        }

        const childIds = children.map(child => child._id);
        allIds.push(...childIds);
        currentParents = childIds;
    }

    return allIds;
};

// 创建笔记或目录
exports.createNote = asyncHandler(async (req, res, next) => {
    const { title, content, notebookId, tags, type = 'note', parentId = null } = req.body;
    const userId = req.user._id;

    // 校验父级节点归属
    let safeParentId = parentId && parentId !== 'null' ? parentId : null;
    if (safeParentId) {
        const parentNode = await Note.findOne({ _id: safeParentId, userId, isDeleted: false });
        if (!parentNode) {
            return next(new AppError('目标父目录不存在', 404));
        }
        if (parentNode.type !== 'folder') {
            return next(new AppError('父节点必须是目录类型', 400));
        }
    }

    const note = await Note.create({
        title: (title || '').trim() || (type === 'folder' ? '新建文件夹' : '无标题笔记'),
        content: type === 'folder' ? '' : (content || ''),
        rawContent: type === 'folder' ? '' : (content || ''),
        notebookId,
        userId,
        type,
        parentId: safeParentId,
        tags: tags || []
    });

    if (tags && tags.length > 0) {
        await Tag.updateMany(
            { _id: { $in: tags } },
            { $inc: { count: 1 } }
        );
    }

    res.status(201).json({
        code: 200,
        message: type === 'folder' ? '创建目录成功' : '创建笔记成功',
        data: {
            note
        }
    });
});

// 获取笔记本中的所有笔记与目录（返回平铺与组装树）
exports.getNotebookNotes = asyncHandler(async (req, res) => {
    const { notebookId } = req.params;
    const userId = req.user._id;
    const keywordFilter = buildKeywordFilter(req.query.keyword || req.query.search);

    const query = {
        notebookId,
        userId,
        isDeleted: false
    };

    if (keywordFilter) {
        Object.assign(query, keywordFilter);
    }

    // 排序优先级：目录优先，其次按修改时间倒序
    const notes = await Note.find(query)
        .sort({ type: -1, updatedAt: -1 })
        .select('title content type parentId isStarred tags updatedAt createdAt notebookId');

    const tree = buildNodeTree(notes);

    res.status(200).json({
        code: 200,
        message: '获取笔记列表成功',
        data: {
            notes,
            tree,
            total: notes.length
        }
    });
});

exports.getStarredNotes = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20, sort = '-updatedAt' } = req.query;
    const skip = (page - 1) * limit;
    const keywordFilter = buildKeywordFilter(req.query.keyword || req.query.search);

    const query = {
        userId,
        isDeleted: false,
        isStarred: true
    };

    if (keywordFilter) {
        Object.assign(query, keywordFilter);
    }

    const notes = await Note.find(query)
        .sort(sort)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('title content updatedAt createdAt isStarred tags notebookId');

    const total = await Note.countDocuments(query);

    res.status(200).json({
        code: 200,
        message: '获取收藏笔记成功',
        data: {
            notes,
            results: notes.length,
            total
        }
    });
});

exports.getRecentNotes = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;
    const keywordFilter = buildKeywordFilter(req.query.keyword || req.query.search);

    const query = {
        userId,
        isDeleted: false
    };

    if (keywordFilter) {
        Object.assign(query, keywordFilter);
    }

    const notes = await Note.find(query)
        .sort({ lastOpenedAt: -1, updatedAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('title content updatedAt createdAt lastOpenedAt isStarred tags notebookId');

    const total = await Note.countDocuments(query);

    res.status(200).json({
        code: 200,
        message: '获取最近文档成功',
        data: {
            notes,
            results: notes.length,
            total
        }
    });
});

// 获取单个笔记
exports.getNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId, isDeleted: false })
        .populate('tags', 'name color');

    if (!note) {
        return next(new AppError('笔记不存在', 404));
    }

    // 更新最后访问时间
    note.lastOpenedAt = new Date();
    await note.save({ validateBeforeSave: false });

    res.status(200).json({
        code: 200,
        message: '获取笔记成功',
        data: {
            note
        }
    });
});

// 更新笔记
exports.updateNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;
    const updateData = req.body;

    // 检查并处理标签变更
    if (updateData.tags) {
        const currentNote = await Note.findById(noteId);
        if (currentNote) {
            // 找出新增的标签
            const newTags = updateData.tags.filter(
                tag => !currentNote.tags.includes(tag)
            );

            // 找出移除的标签
            const removedTags = currentNote.tags.filter(
                tag => !updateData.tags.includes(tag.toString())
            );

            // 更新标签计数
            if (newTags.length > 0) {
                await Tag.updateMany(
                    { _id: { $in: newTags } },
                    { $inc: { count: 1 } }
                );
            }

            if (removedTags.length > 0) {
                await Tag.updateMany(
                    { _id: { $in: removedTags } },
                    { $inc: { count: -1 } }
                );
            }
        }
    }

    const note = await Note.findOneAndUpdate(
        { _id: noteId, userId },
        updateData,
        {
            new: true,
            runValidators: true
        }
    ).populate('tags', 'name color');

    if (!note) {
        return next(new AppError('笔记不存在', 404));
    }

    res.status(200).json({
        code: 200,
        message: '更新笔记成功',
        data: {
            note
        }
    });
});

exports.toggleStarred = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;
    const { isStarred } = req.body;

    const note = await Note.findOneAndUpdate(
        { _id: noteId, userId, isDeleted: false },
        {
            isStarred: Boolean(isStarred),
            updatedAt: new Date()
        },
        {
            new: true,
            runValidators: true
        }
    ).populate('tags', 'name color');

    if (!note) {
        return next(new AppError('笔记不存在', 404));
    }

    res.status(200).json({
        code: 200,
        message: isStarred ? '收藏笔记成功' : '取消收藏成功',
        data: {
            note
        }
    });
});

// 删除笔记或目录(级联软删除)
exports.deleteNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId });
    if (!note) {
        return next(new AppError('笔记或目录不存在', 404));
    }

    const idsToDelete = [note._id];
    if (note.type === 'folder') {
        const descendantIds = await findDescendantIds([note._id], userId, false);
        idsToDelete.push(...descendantIds);
    }

    await Note.updateMany(
        { _id: { $in: idsToDelete }, userId },
        {
            isDeleted: true,
            deletedAt: new Date(),
            updatedAt: new Date()
        }
    );

    if (note.tags && note.tags.length > 0) {
        await Tag.updateMany(
            { _id: { $in: note.tags } },
            { $inc: { count: -1 } }
        );
    }

    res.status(200).json({
        code: 200,
        message: note.type === 'folder' ? '删除目录成功' : '删除笔记成功',
        data: null
    });
});

// 获取回收站笔记与目录
exports.getDeletedNotes = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 50, sort = '-deletedAt' } = req.query;
    const skip = (page - 1) * limit;
    const keywordFilter = buildKeywordFilter(req.query.keyword || req.query.search);

    const query = {
        userId,
        isDeleted: true
    };

    if (keywordFilter) {
        Object.assign(query, keywordFilter);
    }

    const notes = await Note.find(query)
        .sort(sort)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('title content type parentId updatedAt createdAt deletedAt notebookId tags');

    const total = await Note.countDocuments(query);

    res.status(200).json({
        code: 200,
        message: '获取回收站笔记成功',
        data: {
            notes,
            results: notes.length,
            total
        }
    });
});

// 恢复笔记或目录(级联恢复)
exports.restoreNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findOne({ _id: noteId, userId, isDeleted: true });
    if (!note) {
        return next(new AppError('笔记或目录不存在', 404));
    }

    let resetParent = false;
    if (note.parentId) {
        const parentFolder = await Note.findOne({ _id: note.parentId, userId, isDeleted: false });
        if (!parentFolder) {
            resetParent = true;
        }
    }

    const idsToRestore = [note._id];
    if (note.type === 'folder') {
        const descendantIds = await findDescendantIds([note._id], userId, true);
        idsToRestore.push(...descendantIds);
    }

    await Note.updateMany(
        { _id: { $in: idsToRestore }, userId },
        {
            isDeleted: false,
            deletedAt: null,
            updatedAt: new Date()
        }
    );

    if (resetParent) {
        await Note.updateOne({ _id: note._id, userId }, { parentId: null });
    }

    const restoredNote = await Note.findById(note._id).populate('tags', 'name color');

    res.status(200).json({
        code: 200,
        message: '恢复成功',
        data: {
            note: restoredNote
        }
    });
});

// 移动笔记或目录到目标父级
exports.moveNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;
    const { targetParentId = null, notebookId } = req.body;

    const note = await Note.findOne({ _id: noteId, userId, isDeleted: false });
    if (!note) {
        return next(new AppError('笔记或目录不存在', 404));
    }

    const safeParentId = targetParentId && targetParentId !== 'null' ? targetParentId : null;

    if (safeParentId) {
        if (safeParentId === noteId) {
            return next(new AppError('不能将目录移动到自身内部', 400));
        }

        const targetParent = await Note.findOne({ _id: safeParentId, userId, isDeleted: false });
        if (!targetParent) {
            return next(new AppError('目标父目录不存在', 404));
        }

        if (targetParent.type !== 'folder') {
            return next(new AppError('目标父节点必须是目录', 400));
        }

        if (note.type === 'folder') {
            const descendantIds = await findDescendantIds([note._id], userId, false);
            const isChild = descendantIds.some(id => id.toString() === safeParentId.toString());
            if (isChild) {
                return next(new AppError('不能将目录移动到自身的子目录中', 400));
            }
        }
    }

    const updateFields = {
        parentId: safeParentId,
        updatedAt: new Date()
    };

    if (notebookId && notebookId !== note.notebookId.toString()) {
        updateFields.notebookId = notebookId;
        if (note.type === 'folder') {
            const descendantIds = await findDescendantIds([note._id], userId, false);
            await Note.updateMany(
                { _id: { $in: descendantIds }, userId },
                { notebookId, updatedAt: new Date() }
            );
        }
    }

    const updatedNote = await Note.findOneAndUpdate(
        { _id: noteId, userId },
        updateFields,
        { new: true }
    );

    res.status(200).json({
        code: 200,
        message: '移动成功',
        data: {
            note: updatedNote
        }
    });
});

// 搜索笔记
exports.searchNotes = asyncHandler(async (req, res, next) => {
    const { query } = req.query;
    const userId = req.user._id;

    if (!query) {
        return next(new AppError('请提供搜索关键词', 400));
    }

    const notes = await Note.find(
        {
            userId,
            isDeleted: false,
            $or: [
                { title: { $regex: query, $options: 'i' } },
                { content: { $regex: query, $options: 'i' } }
            ]
        }
    )
        .sort('-updatedAt')
        .limit(20)
        .select('title updatedAt createdAt notebookId');

    res.status(200).json({
        code: 200,
        message: '搜索笔记成功',
        data: {
            notes,
            results: notes.length
        }
    });
});
