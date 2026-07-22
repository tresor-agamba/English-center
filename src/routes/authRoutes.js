const express = require('express');
const authController = require('../controllers/authController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

router.get('/login', authController.showLogin);
router.post('/login', asyncHandler(authController.login));
router.post('/logout', authController.logout);

module.exports = router;
