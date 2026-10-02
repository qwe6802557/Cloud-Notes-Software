const express = require('express');
const aiController = require('../controllers/aiController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// 全路由用户鉴权保护
router.use(protect);

// SSE 打字机流式生成接口
router.post('/stream', aiController.streamAI);

// 获取用户 AI 配置
router.get('/config', aiController.getAIConfig);

// 更新用户个人自定义 AI 配置
router.put('/config', aiController.updateAIConfig);

// 大模型端点连通性测试
router.post('/test-connection', aiController.testConnection);

module.exports = router;
