const notebookService = require('../services/notebookService');
const asyncHandler = require('../utils/asyncHandler');

// 获取用户的所有笔记本
exports.getUserNotebooks = asyncHandler(async (req, res) => {
    const notebooks = await notebookService.getUserNotebooks(req.user._id);

    res.status(200).json({
        status: 'success',
        results: notebooks.length,
        data: {
            notebooks
        }
    });
});

// 创建笔记本
exports.createNotebook = asyncHandler(async (req, res) => {
    const notebook = await notebookService.createNotebook(req.body, req.user._id);

    res.status(201).json({
        status: 'success',
        data: {
            notebook
        }
    });
});

// 获取单个笔记本
exports.getNotebook = asyncHandler(async (req, res) => {
    // req.resource 来自 checkOwnership 中间件
    const notebook = req.resource;

    res.status(200).json({
        status: 'success',
        data: {
            notebook
        }
    });
});

// 更新笔记本
exports.updateNotebook = asyncHandler(async (req, res) => {
    const notebook = await notebookService.updateNotebook(
        req.params.id,
        req.body,
        req.user._id
    );

    res.status(200).json({
        status: 'success',
        data: {
            notebook
        }
    });
});

// 删除笔记本
exports.deleteNotebook = asyncHandler(async (req, res) => {
    await notebookService.deleteNotebook(req.params.id, req.user._id);

    res.status(204).json({
        status: 'success',
        data: null
    });
});