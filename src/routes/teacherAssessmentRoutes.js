const router = require('express').Router();
const controller = require('../controllers/teacherAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/oral-assessments', asyncHandler(controller.index));
router.get('/oral-assessments/new', asyncHandler(controller.newForm));
router.post('/oral-assessments', asyncHandler(controller.create));
router.get('/oral-assessments/:id/edit', asyncHandler(controller.edit));
router.get('/oral-assessments/:id', asyncHandler(controller.show));
router.post('/oral-assessments/:id', asyncHandler(controller.update));
router.post('/oral-assessments/:id/publish', asyncHandler(controller.publish));
router.get('/oral-responses/:id/audio', asyncHandler(controller.audio));
router.get('/oral-attempts/:id', asyncHandler(controller.attempt));
router.post('/oral-attempts/:id/grade', asyncHandler(controller.gradeAttempt));
router.post('/oral-evaluations/:id/publish', asyncHandler(controller.publishEvaluation));

module.exports = router;
