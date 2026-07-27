const router = require('express').Router();
const controller = require('../controllers/certificateVerificationController');
const asyncHandler = require('../middlewares/asyncHandler');
const rateLimit = require('../middlewares/certificateVerificationRateLimit');

router.use(rateLimit);
router.get('/verify', controller.form);
router.post('/verify', asyncHandler(controller.search));
router.get('/verify/:verificationCode', asyncHandler(controller.byCode));

module.exports = router;
