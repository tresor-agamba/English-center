const express = require('express');
const controller = require('../controllers/enrollmentController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuthenticated = require('../middlewares/requireAuthenticated');

const router = express.Router();

router.get('/enroll', requireAuthenticated, asyncHandler(controller.confirm));
router.post('/enroll', requireAuthenticated, asyncHandler(controller.create));

module.exports = router;
