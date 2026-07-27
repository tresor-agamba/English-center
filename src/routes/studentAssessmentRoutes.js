const router = require('express').Router();
const controller = require('../controllers/studentAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');
const upload = require('../middlewares/oralAudioUpload');

router.get('/oral-assessments', asyncHandler(controller.index));
router.get('/oral-assessments/:id', asyncHandler(controller.show));
router.post('/oral-assessments/:id/attempts', asyncHandler(controller.createAttempt));
router.get('/oral-responses/:id/audio', asyncHandler(controller.audio));
router.get('/oral-attempts/:id/result', asyncHandler(controller.result));
router.get('/oral-attempts/:id', asyncHandler(controller.showAttempt));
router.post('/oral-attempts/:id/responses/:questionId/audio', upload.singleAudio, asyncHandler(controller.uploadResponse));
router.post('/oral-attempts/:id/submit', asyncHandler(controller.submitAttempt));

module.exports = router;
