const express = require('express');
const controller = require('../controllers/classMeetingController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireStudent = require('../middlewares/requireStudent');

const router = express.Router();
router.get('/class-meetings/:id/join', requireStudent, asyncHandler(controller.join));
module.exports = router;
