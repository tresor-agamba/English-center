const router = require('express').Router();
const controller = require('../controllers/studentWrittenAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');

router.get('/written-assessments', asyncHandler(controller.index));
router.get('/written-assessments/:id', asyncHandler(controller.show));
router.post('/written-assessments/:id/attempts', asyncHandler(controller.start));
router.get('/written-attempts/:id', asyncHandler(controller.attempt));
router.post('/written-attempts/:id/responses/:questionId', asyncHandler(controller.save));
router.post('/written-attempts/:id/submit', limits.assessmentSubmit, asyncHandler(controller.submit));
router.get('/written-attempts/:id/result', asyncHandler(controller.result));
router.get('/written-attempts/:id/questions/:questionId/audio', asyncHandler(controller.audio));

module.exports = router;
