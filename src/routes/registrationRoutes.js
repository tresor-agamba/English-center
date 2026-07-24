const express = require('express');
const controller = require('../controllers/registrationController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

router.get('/register', asyncHandler(controller.newForm));
router.post('/register', asyncHandler(controller.create));
router.get('/registration/success/:enrollmentId', asyncHandler(controller.success));

module.exports = router;
