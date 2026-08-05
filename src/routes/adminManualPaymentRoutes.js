const router = require('express').Router();
const controller = require('../controllers/adminManualPaymentController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');

router.get('/payment-methods', asyncHandler(controller.methods));
router.post('/payment-methods', asyncHandler(controller.createMethod));
router.post('/payment-methods/:id', asyncHandler(controller.updateMethod));
router.post('/payment-methods/:id/toggle', asyncHandler(controller.toggleMethod));
router.get('/manual-payments', asyncHandler(controller.pending));
router.post('/manual-payments/:reference/confirm', limits.payment, asyncHandler(controller.confirm));
router.post('/manual-payments/:reference/refuse', limits.payment, asyncHandler(controller.refuse));
router.get('/manual-payments/:reference/proof', limits.privateDownload, asyncHandler(controller.proof));
router.get('/manual-payments/:reference/receipt', limits.privateDownload, asyncHandler(controller.receipt));

module.exports = router;
