const express = require('express');
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validator');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/verifyCode', authController.sendVerificationCode);
router.post('/register', validate(schemas.userRegister), authController.register);
router.post('/login', validate(schemas.userLogin), authController.login);
router.get('/currentUser', protect, authController.getCurrentUser);
router.post('/logout', authController.logout);

module.exports = router;