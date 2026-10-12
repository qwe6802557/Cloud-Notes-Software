const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ragController = require('../controllers/ragController');

router.use(protect);

router.get('/stats', ragController.getStats);
router.post('/reindex', ragController.reindex);
router.post('/search', ragController.search);
router.post('/chat', ragController.streamChat);
router.get('/related-notes/:noteId', ragController.getRelatedNotes);
router.get('/semantic-graph', ragController.getSemanticGraph);

module.exports = router;
