const router = require('express').Router();
const c = require('../controllers/academicController');
const a = require('../middlewares/asyncHandler');
router.get('/academic', a(c.studentDashboard));
module.exports = router;
