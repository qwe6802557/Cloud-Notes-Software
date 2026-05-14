const express = require('express');
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');
const { uploadNoteImage } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

router.post('/notes', uploadNoteImage.single('image'), uploadController.uploadNoteImage);

module.exports = router;
