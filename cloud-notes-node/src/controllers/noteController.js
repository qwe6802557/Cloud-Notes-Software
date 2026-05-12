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

// 创建笔记
exports.createNote = asyncHandler(async (req, res) => {
    const { title, content, notebookId, tags } = req.body;
    const userId = req.user._id;

    // 创建笔记
    const note = await Note.create({
        title: title || '无标题笔记',
        content,
        rawContent: content, // 或处理后的原始内容
        notebookId,
        userId,
        tags: tags || []
    });

    // 更新标签使用计数
    if (tags && tags.length > 0) {
        await Tag.updateMany(
            { _id: { $in: tags } },
            { $inc: { count: 1 } }
        );
    }

    res.status(201).json({
        code: 200,
        message: '创建笔记成功',
        data: {
            note
        }
    });
});

// 获取笔记本中的所有笔记
exports.getNotebookNotes = asyncHandler(async (req, res) => {
    const { notebookId } = req.params;
    const userId = req.user._id;

    const { page = 1, limit = 20, sort = '-updatedAt' } = req.query;
    const skip = (page - 1) * limit;
    const keywordFilter = buildKeywordFilter(req.query.keyword || req.query.search);

    const query = {
        notebookId,
        userId,
        isDeleted: false
    };

    if (keywordFilter) {
        Object.assign(query, keywordFilter);
    }

    const notes = await Note.find(query)
        .sort(sort)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('title content updatedAt createdAt isStarred tags');

    const total = await Note.countDocuments(query);

    res.status(200).json({
        code: 200,
        message: '获取笔记列表成功',
        data: {
            notes,
            results: notes.length,
            total
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

// 删除笔记(软删除)
exports.deleteNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findOneAndUpdate(
        { _id: noteId, userId },
        {
            isDeleted: true,
            deletedAt: new Date(),
            updatedAt: new Date()
        },
        { new: true }
    );

    if (!note) {
        return next(new AppError('笔记不存在', 404));
    }

    // 更新标签计数
    if (note.tags && note.tags.length > 0) {
        await Tag.updateMany(
            { _id: { $in: note.tags } },
            { $inc: { count: -1 } }
        );
    }

    res.status(200).json({
        code: 200,
        message: '删除笔记成功',
        data: null
    });
});

// 获取回收站笔记
exports.getDeletedNotes = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { page = 1, limit = 20, sort = '-deletedAt' } = req.query;
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
        .select('title content updatedAt createdAt deletedAt notebookId tags');

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

// 恢复笔记
exports.restoreNote = asyncHandler(async (req, res, next) => {
    const noteId = req.params.id;
    const userId = req.user._id;

    const note = await Note.findOneAndUpdate(
        { _id: noteId, userId, isDeleted: true },
        {
            isDeleted: false,
            deletedAt: null,
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

    if (note.tags && note.tags.length > 0) {
        await Tag.updateMany(
            { _id: { $in: note.tags } },
            { $inc: { count: 1 } }
        );
    }

    res.status(200).json({
        code: 200,
        message: '恢复笔记成功',
        data: {
            note
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
