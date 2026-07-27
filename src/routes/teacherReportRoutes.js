const router = require('express').Router();
const c = require('../controllers/reportController');
const a = require('../middlewares/asyncHandler');
router.get('/reports', a(c.teacher));
module.exports = router;
