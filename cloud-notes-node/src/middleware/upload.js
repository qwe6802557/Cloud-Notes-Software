const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');

const notesUploadDir = path.join(config.uploads.path, 'notes');
const allowedImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

fs.mkdirSync(notesUploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, notesUploadDir);
    },
    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname || '').toLowerCase() || '.png';
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;

        cb(null, uniqueName);
    }
});

const fileFilter = (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const isAllowedMime = config.uploads.allowedTypes.includes(file.mimetype);
    const isAllowedExtension = allowedImageExtensions.has(extension);

    if (isAllowedMime || isAllowedExtension) {
        cb(null, true);
        return;
    }

    cb(new Error('仅支持上传 JPG、PNG、GIF、WEBP 格式图片'));
};

const uploadNoteImage = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: config.uploads.maxSize,
        files: 1
    }
});

module.exports = {
    uploadNoteImage
};
