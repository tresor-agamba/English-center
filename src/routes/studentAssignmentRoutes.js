const express = require('express');
const controller = require('../controllers/studentAssignmentController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/assignments', asyncHandler(controller.index));
router.get('/courses/:enrollmentId/assignments', asyncHandler(controller.courseAssignments));
router.get('/courses/:enrollmentId/assignments/:assignmentId', asyncHandler(controller.show));
router.post('/courses/:enrollmentId/assignments/:assignmentId/submit', asyncHandler(controller.submit));
module.exports = router;
