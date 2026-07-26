const router = require('express').Router();
const c = require('../controllers/studentCertificateController');
const a = require('../middlewares/asyncHandler');
router.get('/certificates', a(c.index));
router.get('/certificates/:id', a(c.show));
module.exports = router;
