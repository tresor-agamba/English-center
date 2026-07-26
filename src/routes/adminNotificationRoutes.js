const router = require('express').Router();
const c = require('../controllers/adminNotificationController');
const a = require('../middlewares/asyncHandler');
router.get('/announcements', a(c.index));
router.get('/announcements/new', a(c.newForm));
router.post('/announcements', a(c.create));
module.exports = router;
