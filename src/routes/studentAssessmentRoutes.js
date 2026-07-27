const router = require('express').Router();
const controller = require('../controllers/studentAssessmentController');

router.get('/oral-assessments', controller.index);
router.get('/oral-assessments/:id', controller.show);
router.post('/oral-assessments/:id/attempts', controller.createAttempt);
router.get('/oral-attempts/:id', controller.showAttempt);
router.post('/oral-attempts/:id/responses/:questionId/audio', controller.uploadResponse);
router.post('/oral-attempts/:id/submit', controller.submitAttempt);
router.get('/oral-attempts/:id/result', controller.result);
router.get('/live-oral-sessions', controller.liveSessions);
router.get('/live-oral-sessions/:id', controller.liveSession);
router.get('/live-oral-sessions/:id/join', controller.joinLiveSession);

module.exports = router;
