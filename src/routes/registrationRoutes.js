const express = require('express');
const controller = require('../controllers/registrationController');
const asyncHandler = require('../middlewares/asyncHandler');
const requireStudent = require('../middlewares/requireStudent');

const router = express.Router();

router.get('/register', asyncHandler(controller.newForm));
router.post('/register', asyncHandler(controller.create));
router.get('/registration/success/:enrollmentId', asyncHandler(controller.success));
router.get('/placement-test/:enrollmentId', requireStudent, asyncHandler(controller.placementForm));
router.post('/placement-test/:enrollmentId', requireStudent, asyncHandler(controller.submitPlacement));

module.exports = router;
