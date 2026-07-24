const express = require('express');
const controller = require('../controllers/publicCourseController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(controller.index));
router.get('/:slug', asyncHandler(controller.show));

module.exports = router;
