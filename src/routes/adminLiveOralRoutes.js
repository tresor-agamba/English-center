const router = require('express').Router();
const controller = require('../controllers/adminLiveOralController');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/live-oral-assessments', asyncHandler(controller.assessmentIndex));
router.get('/live-oral-assessments/new', asyncHandler(controller.assessmentNew));
router.post('/live-oral-assessments', asyncHandler(controller.assessmentCreate));
router.get('/live-oral-assessments/:id', asyncHandler(controller.assessmentShow));
router.post('/live-oral-assessments/:id/publish', asyncHandler(controller.assessmentPublish));
router.get('/live-oral-sessions', asyncHandler(controller.sessionIndex));
router.get('/live-oral-sessions/new', asyncHandler(controller.sessionNew));
router.post('/live-oral-sessions', asyncHandler(controller.sessionCreate));
router.get('/live-oral-sessions/:id', asyncHandler(controller.sessionShow));
router.post('/live-oral-sessions/:id/cancel', asyncHandler(controller.cancel));
router.post('/live-oral-sessions/:id/reschedule', asyncHandler(controller.reschedule));

module.exports = router;
