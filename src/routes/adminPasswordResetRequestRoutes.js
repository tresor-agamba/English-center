const express = require('express');
const controller = require('../controllers/adminPasswordResetRequestController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');
const router = express.Router();

router.use((_req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); next(); });
router.get('/', asyncHandler(controller.index));
router.get('/:id', asyncHandler(controller.show));
router.post('/:id/approve', asyncHandler(controller.approve));
router.post('/:id/reject', asyncHandler(controller.reject));
router.post('/:id/send', limits.passwordResetDelivery, asyncHandler(controller.send));
router.use(controller.handleError);

module.exports = router;
