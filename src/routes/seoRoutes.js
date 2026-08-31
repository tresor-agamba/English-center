const express = require('express');
const controller = require('../controllers/seoController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/robots.txt', controller.robots);
router.get('/sitemap.xml', asyncHandler(controller.sitemap));
module.exports = router;
