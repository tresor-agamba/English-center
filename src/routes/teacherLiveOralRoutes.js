const router = require('express').Router();
const controller = require('../controllers/teacherLiveOralController');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/live-oral-sessions', asyncHandler(controller.index));
router.get('/live-oral-sessions/new', asyncHandler(controller.newForm));
router.post('/live-oral-sessions', asyncHandler(controller.create));
router.get('/live-oral-sessions/:id', asyncHandler(controller.show));
router.get('/live-oral-sessions/:id/join', asyncHandler(controller.join));
router.post('/live-oral-sessions/:id/join', asyncHandler(controller.join));
router.post('/live-oral-sessions/:id/start', asyncHandler(controller.start));
router.post('/live-oral-sessions/:id/complete', asyncHandler(controller.complete));
router.post('/live-oral-sessions/:id/attendance', asyncHandler(controller.attendance));
router.post('/live-oral-sessions/:id/grade', asyncHandler(controller.grade));
router.post('/live-oral-sessions/:id/enrollments/:enrollmentId/grade', asyncHandler(controller.grade));
router.post('/live-oral-sessions/:id/reschedule', asyncHandler(controller.reschedule));
router.post('/live-oral-sessions/:id/cancel', asyncHandler(controller.cancel));
router.post('/live-oral-evaluations/:id/publish', asyncHandler(controller.publishEvaluation));

module.exports = router;
