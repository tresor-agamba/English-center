const router = require('express').Router();
const c = require('../controllers/systemController');
const a = require('../middlewares/asyncHandler');
router.get('/health', a(c.publicHealth));
router.get('/ready', a(c.readiness));
module.exports = router;
