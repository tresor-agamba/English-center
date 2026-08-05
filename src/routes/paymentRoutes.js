const express = require('express');
const controller = require('../controllers/paymentController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireStudent = require('../middlewares/requireStudent');
const limits = require('../middlewares/rateLimits');
const proofUpload = require('../middlewares/manualPaymentProofUpload');

const router = express.Router();

router.post('/payments', limits.payment, requireStudent, asyncHandler(controller.create));
router.get('/payments/:reference', requireStudent, asyncHandler(controller.show));
router.post('/payments/:reference/declare', limits.payment, requireStudent, proofUpload, asyncHandler(controller.declare));
router.get('/payments/:reference/proof', limits.privateDownload, requireStudent, asyncHandler(controller.proof));
router.get('/payments/:reference/receipt', limits.privateDownload, requireStudent, asyncHandler(controller.receipt));
router.post('/payments/:reference/simulate-success', requireStudent, asyncHandler(controller.simulateSuccess));
router.post('/payments/:reference/simulate-failure', requireStudent, asyncHandler(controller.simulateFailure));

module.exports = router;
