const express = require('express');
const noteController = require('../controllers/noteController');
const { protect } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validator');

const router = express.Router();

router.use(protect);

router.get('/search', noteController.searchNotes);
router.get('/recent', noteController.getRecentNotes);
router.get('/starred', noteController.getStarredNotes);
router.get('/deleted', noteController.getDeletedNotes);
router.get('/notebook/:notebookId', noteController.getNotebookNotes);
router.post('/', validate(schemas.noteCreate, 'body'), noteController.createNote);
router.get('/:id', noteController.getNote);
router.put('/:id', noteController.updateNote);
router.put('/:id/starred', noteController.toggleStarred);
router.put('/:id/restore', noteController.restoreNote);
router.put('/:id/move', validate(schemas.noteMove, 'body'), noteController.moveNote);
router.delete('/:id', noteController.deleteNote);

module.exports = router;
