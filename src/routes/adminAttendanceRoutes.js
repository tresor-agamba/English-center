const express = require('express');
const controller = require('../controllers/adminAttendanceController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.post('/', asyncHandler(controller.create));
module.exports = router;
