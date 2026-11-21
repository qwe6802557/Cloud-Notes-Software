const express = require('express');
const quickNoteController = require('../controllers/quickNoteController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validator');
const { uploadStashFile } = require('../middleware/upload');
const { quickNotesUploadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(protect);

router.get('/', quickNoteController.listQuickNotes);
router.get('/delta', quickNoteController.deltaQuickNotes);
router.post('/text', validate(schemas.quickNoteText, 'body'), quickNoteController.createTextMemo);
router.post('/upload', quickNotesUploadLimiter, uploadStashFile.single('file'), quickNoteController.uploadFileMemo);

router.post('/folder/promote', quickNoteController.promoteFolder);
router.delete('/folder', quickNoteController.deleteFolder);
router.get('/folder/download', quickNoteController.downloadFolder);

router.post('/:id/promote', quickNoteController.promoteMemo);
router.post('/:id/extend', quickNoteController.extendMemo);
router.post('/:id/to-note', quickNoteController.convertToNote);
router.delete('/:id', quickNoteController.deleteMemo);

module.exports = router;
