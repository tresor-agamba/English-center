const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');

const router = express.Router();

router.get('/login', authController.showLogin);
router.post('/login', limits.login, asyncHandler(authController.login));
router.post('/logout', authController.logout);

module.exports = router;
