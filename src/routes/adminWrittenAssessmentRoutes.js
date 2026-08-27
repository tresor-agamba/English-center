const router = require('express').Router();
const controller = require('../controllers/adminWrittenAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');
const upload = require('../middlewares/oralAudioUpload');
const csrf = require('../middlewares/csrfProtection');

router.get('/', asyncHandler(controller.index));
router.get('/new', asyncHandler(controller.newForm));
router.post('/', asyncHandler(controller.create));
router.get('/:id/edit', asyncHandler(controller.edit));
router.post('/:id', asyncHandler(controller.update));
router.get('/:id', asyncHandler(controller.show));
router.post('/:id/publish', asyncHandler(controller.publish));
router.post('/:id/close', asyncHandler(controller.close));
router.post('/:id/questions/:questionId/audio', upload.singleAudio, csrf.verify, asyncHandler(controller.uploadAudio));
router.get('/:id/questions/:questionId/audio', asyncHandler(controller.audio));
router.get('/attempts/:id', asyncHandler(controller.attempt));
router.post('/attempts/:id/grade', asyncHandler(controller.grade));
router.post('/evaluations/:id/publish', asyncHandler(controller.publishEvaluation));

module.exports = router;
