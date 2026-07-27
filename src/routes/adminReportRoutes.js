const router = require('express').Router();
const c = require('../controllers/reportController');
const a = require('../middlewares/asyncHandler');
router.get('/', a(c.admin));
router.get('/exports/:type', a(c.exportReport));
module.exports = router;
