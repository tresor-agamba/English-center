const express = require('express');
const controller = require('../controllers/adminAssignmentController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/courses/:courseId/assignments', asyncHandler(controller.index));
router.get('/courses/:courseId/assignments/new', asyncHandler(controller.newForm));
router.post('/courses/:courseId/assignments', asyncHandler(controller.create));
router.get('/assignments/:id', asyncHandler(controller.show));
router.get('/assignments/:id/edit', asyncHandler(controller.editForm));
router.post('/assignments/:id', asyncHandler(controller.update));
router.post('/assignments/:id/toggle-published', asyncHandler(controller.toggle));
router.post('/assignments/:id/delete', asyncHandler(controller.remove));
router.get('/assignments/:id/submissions', asyncHandler(controller.submissions));
router.get('/assignments/:assignmentId/submissions/:submissionId', asyncHandler(controller.submission));
router.post('/assignments/:assignmentId/submissions/:submissionId/grade', asyncHandler(controller.grade));
router.post('/assignments/:assignmentId/submissions/:submissionId/publish-feedback', asyncHandler(controller.publishFeedback));
router.post('/assignments/:assignmentId/submissions/:submissionId/unpublish-feedback', asyncHandler(controller.unpublishFeedback));
module.exports = router;
