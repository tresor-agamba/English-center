const router = require('express').Router();
const c = require('../controllers/reportController');
const a = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');
router.get('/', a(c.admin));
router.get('/exports/:type', limits.exportCsv, a(c.exportReport));
module.exports = router;
