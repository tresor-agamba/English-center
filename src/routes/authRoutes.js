const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');

const router = express.Router();

router.get('/login', authController.showLogin);
router.post('/login', limits.login, asyncHandler(authController.login));
router.get('/change-password', authController.showChangePassword);
router.post('/change-password', limits.passwordReset, asyncHandler(authController.changePassword));
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', limits.passwordReset, asyncHandler(authController.requestPasswordReset));
router.get('/reset-password/:token', asyncHandler(authController.showResetPassword));
router.post('/reset-password/:token', limits.passwordReset, asyncHandler(authController.resetForgottenPassword));
router.post('/logout', authController.logout);

module.exports = router;
