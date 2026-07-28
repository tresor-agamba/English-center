const router = require('express').Router();
const c = require('../controllers/systemController');
const a = require('../middlewares/asyncHandler');
router.get('/health', a(c.publicHealth));
module.exports = router;
