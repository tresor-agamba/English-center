const router = require('express').Router();
const c = require('../controllers/academicController');
const a = require('../middlewares/asyncHandler');
router.get('/academic', a(c.teacherDashboard));
router.post('/academic/sessions', a(c.teacherCreateSession));
router.post('/academic/attendances', a(c.teacherAttendance));
module.exports = router;
