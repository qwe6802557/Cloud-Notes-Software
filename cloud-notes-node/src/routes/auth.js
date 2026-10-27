const express = require('express');
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validator');
const { protect } = require('../middleware/auth');
const { loginLimiter, verifyCodeLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.get('/captcha', authController.getCaptcha);
router.get('/verifyCode', verifyCodeLimiter, validate(schemas.sendVerificationCode, 'query'), authController.sendVerificationCode);
router.post('/register', validate(schemas.userRegister, 'body'), authController.register);
router.post('/login', loginLimiter, validate(schemas.userLogin, 'body'), authController.login);
router.get('/currentUser', protect, authController.getCurrentUser);
router.put('/currentUser', protect, validate(schemas.userUpdate, 'body'), authController.updateCurrentUser);
router.get('/vault-status', protect, authController.getVaultStatus);
router.post('/vault-setup', protect, authController.setupVault);
router.post('/vault-verify', protect, authController.verifyVault);
router.post('/vault-update', protect, authController.updateVault);
router.post('/logout', authController.logout);

module.exports = router;
