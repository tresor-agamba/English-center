const router = require('express').Router();
const c = require('../controllers/centerSettingsController');
const a = require('../middlewares/asyncHandler');
router.get('/', a(c.publicSettings));
router.get('/logo/:kind', a(c.publicLogo));
module.exports = router;
