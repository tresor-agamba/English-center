const router = require('express').Router();
const c = require('../controllers/notificationController');
const a = require('../middlewares/asyncHandler');
router.get('/', a(c.index));
router.post('/read-all', a(c.readAll));
router.post('/:id/read', a(c.read));
router.post('/:id/delete', a(c.remove));
module.exports = router;
