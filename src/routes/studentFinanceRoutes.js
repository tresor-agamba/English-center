const router = require('express').Router();
const c = require('../controllers/simpleFinanceController');
const a = require('../middlewares/asyncHandler');
router.get('/finances', a(c.studentIndex));
router.get('/finances/receipts/:id', a(c.receipt));
module.exports = router;
