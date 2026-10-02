const express = require('express');
const authRoutes = require('./auth');
const notesRoutes = require('./notes');
const notebooksRoutes = require('./notebooks');
const uploadsRoutes = require('./uploads');
const stashRoutes = require('./stash');
const appRoutes = require('./appRelease');
const aiRoutes = require('./ai');

const router = express.Router();

// API路由
router.use('/auth', authRoutes);
router.use('/notes', notesRoutes);
router.use('/notebooks', notebooksRoutes);
router.use('/uploads', uploadsRoutes);
router.use('/stash', stashRoutes);
router.use('/app', appRoutes);
router.use('/ai', aiRoutes);

module.exports = router;
