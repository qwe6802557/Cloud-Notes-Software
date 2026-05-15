const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const config = require('../config');

const getFileUrl = req => {
    if (config.publicBaseUrl) {
        return config.publicBaseUrl;
    }

    const protocol = req.protocol;
    const host = req.get('host');

    return `${protocol}://${host}`;
};

exports.uploadNoteImage = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new AppError('请先选择要上传的图片', 400);
    }

    const baseUrl = getFileUrl(req);
    const relativeUrl = `/uploads/notes/${req.file.filename}`;
    const originalName = req.file.originalname || req.file.filename;

    res.status(200).json({
        code: 200,
        message: '图片上传成功',
        data: {
            url: `${baseUrl}${relativeUrl}`,
            filename: req.file.filename,
            originalName,
            size: req.file.size,
            mimetype: req.file.mimetype,
            alt: path.parse(originalName).name,
            title: originalName
        }
    });
});
