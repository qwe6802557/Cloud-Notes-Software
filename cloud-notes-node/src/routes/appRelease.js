const express = require('express');
const appReleaseController = require('../controllers/appReleaseController');

const router = express.Router();

// 客户端检查更新 (免登录公开端点)
router.get('/check-update', appReleaseController.checkUpdate);

// 获取版本列表
router.get('/releases', appReleaseController.getReleases);

// 提交发布新版本 (支持脚本通过 releaseSecret 签名发布)
router.post('/release', appReleaseController.publishRelease);

module.exports = router;
