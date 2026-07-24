const express = require('express');
const controller = require('../controllers/classMeetingController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuthenticated = require('../middlewares/requireAuthenticated');

const router = express.Router();
router.get('/class-meetings/:id/join', requireAuthenticated, asyncHandler(controller.join));
module.exports = router;
