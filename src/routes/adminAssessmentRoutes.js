const router = require('express').Router();
const controller = require('../controllers/adminAssessmentController');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/', asyncHandler(controller.index));
router.get('/new', asyncHandler(controller.newForm));
router.post('/', asyncHandler(controller.create));
router.get('/responses/:id/audio', asyncHandler(controller.audio));
router.get('/:id/edit', asyncHandler(controller.edit));
router.get('/:id', asyncHandler(controller.show));
router.post('/:id', asyncHandler(controller.update));
router.post('/:id/publish', asyncHandler(controller.publish));

module.exports = router;
