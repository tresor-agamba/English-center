const router = require('express').Router();
const c = require('../controllers/adminWhatsAppController');
const a = require('../middlewares/asyncHandler');
router.get('/deliveries', a(c.deliveries));
router.post('/deliveries/:id/retry', a(c.retry));
router.post('/users/:id/enable', a(c.enable));
router.post('/users/:id/disable', a(c.disable));
module.exports = router;
