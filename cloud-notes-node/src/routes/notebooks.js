const express = require('express');
const notebookController = require('../controllers/notebookController');
const Notebook = require('../models/Notebook');
const { protect, checkOwnership } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validator');

const router = express.Router();

router.use(protect);

router
    .route('/')
    .get(notebookController.getUserNotebooks)
    .post(validate(schemas.notebookCreate, 'body'), notebookController.createNotebook);

router
    .route('/:id')
    .get(checkOwnership(Notebook), notebookController.getNotebook)
    .put(validate(schemas.notebookCreate, 'body'), notebookController.updateNotebook)
    .delete(notebookController.deleteNotebook);

module.exports = router;
