const express = require('express');
const authRoutes = require('./auth');
const notesRoutes = require('./notes');
const notebooksRoutes = require('./notebooks');

const router = express.Router();

// API路由
router.use('/auth', authRoutes);
router.use('/notes', notesRoutes);
router.use('/notebooks', notebooksRoutes);

module.exports = router;
