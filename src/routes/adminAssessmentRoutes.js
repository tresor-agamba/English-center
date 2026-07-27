const router = require('express').Router();
const controller = require('../controllers/adminAssessmentController');

router.get('/', controller.index);
router.get('/new', controller.newForm);
router.post('/', controller.create);
router.post('/live-sessions', controller.createLiveSession);
router.post('/live-sessions/:id/reschedule', controller.rescheduleLiveSession);
router.post('/live-sessions/:id/cancel', controller.cancelLiveSession);
router.get('/:id', controller.show);
router.post('/:id', controller.update);
router.post('/:id/publish', controller.publish);
router.post('/:id/close', controller.close);
router.post('/:id/criteria', controller.configureCriteria);

module.exports = router;
