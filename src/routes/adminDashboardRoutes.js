const express = require('express');
const controller = require('../controllers/adminDashboardController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(controller.index));

module.exports = router;
