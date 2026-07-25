const express = require('express');
const controller = require('../controllers/paymentController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireStudent = require('../middlewares/requireStudent');

const router = express.Router();

router.post('/payments', requireStudent, asyncHandler(controller.create));
router.get('/payments/:reference', requireStudent, asyncHandler(controller.show));
router.post('/payments/:reference/simulate-success', requireStudent, asyncHandler(controller.simulateSuccess));
router.post('/payments/:reference/simulate-failure', requireStudent, asyncHandler(controller.simulateFailure));

module.exports = router;
