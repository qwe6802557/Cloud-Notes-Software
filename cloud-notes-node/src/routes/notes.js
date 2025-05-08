const express = require('express');
const router = express.Router();

// 获取所有笔记
router.get('/', (req, res) => {
    res.json({ message: '获取所有笔记' });
});

// 获取单个笔记
router.get('/:id', (req, res) => {
    res.json({ message: `获取ID为${req.params.id}的笔记` });
});

// 创建笔记
router.post('/', (req, res) => {
    res.json({ message: '创建新笔记', data: req.body });
});

// 更新笔记
router.put('/:id', (req, res) => {
    res.json({ message: `更新ID为${req.params.id}的笔记`, data: req.body });
});

// 删除笔记
router.delete('/:id', (req, res) => {
    res.json({ message: `删除ID为${req.params.id}的笔记` });
});

module.exports = router;
