const router = require('express').Router();
const controller = require('../controllers/teacherAssessmentController');

router.get('/oral-assessments', controller.index);
router.get('/oral-attempts/:id', controller.attempt);
router.get('/oral-responses/:id/audio', controller.responseAudio);
router.post('/oral-attempts/:id/grade', controller.gradeAttempt);
router.get('/live-oral-sessions', controller.liveSessions);
router.get('/live-oral-sessions/:id', controller.liveSession);
router.get('/live-oral-sessions/:id/join', controller.joinLiveSession);
router.post('/live-oral-sessions/:id/start', controller.startLiveSession);
router.post('/live-oral-sessions/:id/complete', controller.completeLiveSession);
router.post('/live-oral-sessions/:id/attendance', controller.recordAttendance);
router.post('/live-oral-sessions/:id/grade', controller.gradeLiveSession);
router.post('/oral-evaluations/:id/publish', controller.publishEvaluation);

module.exports = router;
