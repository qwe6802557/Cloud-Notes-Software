const Note = require('../models/Note');
const Tag = require('../models/Tag');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

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
        status: 'success',
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

    const query = {
        notebookId,
        userId,
        isDeleted: false
    };

    const notes = await Note.find(query)
        .sort(sort)
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('title updatedAt createdAt isStarred tags'); // 不返回完整内容

    const total = await Note.countDocuments(query);

    res.status(200).json({
        status: 'success',
        results: notes.length,
        total,
        data: {
            notes
        }
    });
});

// 获取单个笔记
exports.getNote = asyncHandler(async (req, res) => {
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
        status: 'success',
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
        status: 'success',
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

    res.status(204).json({
        status: 'success',
        data: null
    });
});

// 搜索笔记
exports.searchNotes = asyncHandler(async (req, res) => {
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
        status: 'success',
        results: notes.length,
        data: {
            notes
        }
    });
});