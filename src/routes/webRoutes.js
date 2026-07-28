const express = require('express');
const pageController = require('../controllers/pageController');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/', require('../middlewares/asyncHandler')(pageController.showHome));

module.exports = router;
