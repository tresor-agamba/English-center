const router = require('express').Router();
const controller = require('../controllers/studentLiveOralController');
const asyncHandler = require('../middlewares/asyncHandler');

router.get('/live-oral-sessions', asyncHandler(controller.index));
router.get('/live-oral-sessions/:id', asyncHandler(controller.show));
router.get('/live-oral-sessions/:id/join', asyncHandler(controller.join));
router.post('/live-oral-sessions/:id/join', asyncHandler(controller.join));

module.exports = router;
