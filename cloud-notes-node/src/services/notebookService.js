const Notebook = require('../models/Notebook');
const Note = require('../models/Note');
const AppError = require('../utils/AppError');

// 获取用户的所有笔记本
exports.getUserNotebooks = async (userId) => {
    return await Notebook.find({
        userId,
        isDeleted: false
    }).sort({ isDefault: -1, sort: 1, createdAt: -1 });
};

// 创建笔记本
exports.createNotebook = async (notebookData, userId) => {
    // 检查是否存在同名笔记本
    const existingNotebook = await Notebook.findOne({
        userId,
        name: notebookData.name,
        isDeleted: false
    });

    if (existingNotebook) {
        throw new AppError('已存在同名笔记本', 400);
    }

    // 如果设置为默认，则取消其他默认笔记本
    if (notebookData.isDefault) {
        await Notebook.updateMany(
            { userId, isDefault: true },
            { isDefault: false }
        );
    }

    return await Notebook.create({
        ...notebookData,
        userId
    });
};

// 更新笔记本
exports.updateNotebook = async (id, updateData, userId) => {
    const notebook = await Notebook.findOne({ _id: id, userId, isDeleted: false });

    if (!notebook) {
        throw new AppError('笔记本不存在', 404);
    }

    // 检查是否有同名笔记本(排除自身)
    if (updateData.name) {
        const existingNotebook = await Notebook.findOne({
            userId,
            name: updateData.name,
            _id: { $ne: id },
            isDeleted: false
        });

        if (existingNotebook) {
            throw new AppError('已存在同名笔记本', 400);
        }
    }

    // 如果设置为默认，则取消其他默认笔记本
    if (updateData.isDefault) {
        await Notebook.updateMany(
            { userId, isDefault: true, _id: { $ne: id } },
            { isDefault: false }
        );
    }

    return await Notebook.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true
    });
};

// 删除笔记本
exports.deleteNotebook = async (id, userId) => {
    const notebook = await Notebook.findOne({ _id: id, userId });

    if (!notebook) {
        throw new AppError('笔记本不存在', 404);
    }

    // 不允许删除默认笔记本
    if (notebook.isDefault) {
        throw new AppError('不能删除默认笔记本', 400);
    }

    // 查找默认笔记本
    const defaultNotebook = await Notebook.findOne({ userId, isDefault: true });

    if (!defaultNotebook) {
        throw new AppError('未找到默认笔记本', 500);
    }

    // 将要删除的笔记本中的笔记转移到默认笔记本
    await Note.updateMany(
        { notebookId: id, isDeleted: false },
        { notebookId: defaultNotebook._id }
    );

    // 软删除笔记本
    return await Notebook.findByIdAndUpdate(id, {
        isDeleted: true,
        updatedAt: Date.now()
    }, { new: true });
};