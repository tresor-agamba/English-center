const router = require('express').Router();
const c = require('../controllers/simpleFinanceController');
const a = require('../middlewares/asyncHandler');
router.get('/', a(c.adminIndex));
router.post('/fees', a(c.configure));
router.post('/invoices', a(c.invoice));
router.post('/invoices/:invoiceId/payments', a(c.payment));
router.get('/receipts/:id', a(c.receipt));
module.exports = router;
