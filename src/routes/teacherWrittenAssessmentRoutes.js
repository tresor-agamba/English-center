const router = require('express').Router();
const controller = require('../controllers/teacherWrittenAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');
const upload = require('../middlewares/oralAudioUpload');

router.get('/written-assessments', asyncHandler(controller.index));
router.get('/written-assessments/new', asyncHandler(controller.newForm));
router.post('/written-assessments', asyncHandler(controller.create));
router.get('/written-assessments/:id/edit', asyncHandler(controller.edit));
router.post('/written-assessments/:id', asyncHandler(controller.update));
router.get('/written-assessments/:id', asyncHandler(controller.show));
router.post('/written-assessments/:id/publish', asyncHandler(controller.publish));
router.post('/written-assessments/:id/close', asyncHandler(controller.close));
router.post('/written-assessments/:id/questions/:questionId/audio', upload.singleAudio, asyncHandler(controller.uploadAudio));
router.get('/written-assessments/:id/questions/:questionId/audio', asyncHandler(controller.audio));
router.get('/written-attempts/:id', asyncHandler(controller.attempt));
router.post('/written-attempts/:id/grade', asyncHandler(controller.grade));
router.post('/written-evaluations/:id/publish', asyncHandler(controller.publishEvaluation));

module.exports = router;
