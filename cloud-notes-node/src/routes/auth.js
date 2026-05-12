const express = require('express');
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validator');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.get('/verifyCode', validate(schemas.sendVerificationCode, 'query'), authController.sendVerificationCode);
router.post('/register', validate(schemas.userRegister, 'body'), authController.register);
router.post('/login', validate(schemas.userLogin, 'body'), authController.login);
router.get('/currentUser', protect, authController.getCurrentUser);
router.put('/currentUser', protect, validate(schemas.userUpdate, 'body'), authController.updateCurrentUser);
router.post('/logout', authController.logout);

module.exports = router;