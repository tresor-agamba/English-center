const express = require('express');
const controller = require('../controllers/paymentController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireAuthenticated = require('../middlewares/requireAuthenticated');

const router = express.Router();

router.post('/payments', requireAuthenticated, asyncHandler(controller.create));
router.get('/payments/:reference', requireAuthenticated, asyncHandler(controller.show));
router.post('/payments/:reference/simulate-success', requireAuthenticated, asyncHandler(controller.simulateSuccess));
router.post('/payments/:reference/simulate-failure', requireAuthenticated, asyncHandler(controller.simulateFailure));

module.exports = router;
