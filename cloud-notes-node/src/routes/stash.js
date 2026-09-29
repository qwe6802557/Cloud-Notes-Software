const express = require('express');
const stashController = require('../controllers/stashController');
const { protect } = require('../middleware/auth');
const { uploadStashFile } = require('../middleware/upload');

const router = express.Router();

// 全路由鉴权保护
router.use(protect);

// 上传暂存文件 (最大 100MB，支持 temp/permanent)
router.post('/upload', uploadStashFile.single('file'), stashController.uploadFile);

// 获取暂存文件列表
router.get('/', stashController.listFiles);

// 临时文件转永久
router.post('/:id/promote', stashController.promoteToPermanent);

// 下载文件
router.get('/:id/download', stashController.downloadFile);

// 删除暂存文件
router.delete('/:id', stashController.deleteFile);

module.exports = router;
