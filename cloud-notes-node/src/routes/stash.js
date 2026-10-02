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

// 文件夹级批量操作 (必须在 /:id 之前注册)
router.post('/folder/promote', stashController.promoteFolder);
router.delete('/folder', stashController.deleteFolder);
router.get('/folder/download', stashController.downloadFolder);

// 单文件操作
router.post('/:id/promote', stashController.promoteToPermanent);
router.get('/:id/download', stashController.downloadFile);
router.delete('/:id', stashController.deleteFile);

module.exports = router;
