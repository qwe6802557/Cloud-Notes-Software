const express = require('express');
const uploadController = require('../controllers/uploadController');
const { protect } = require('../middleware/auth');
const { uploadNoteImage } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(protect);

router.post('/notes', uploadLimiter, uploadNoteImage.single('image'), uploadController.uploadNoteImage);

module.exports = router;
