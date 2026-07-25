const express = require('express');
const controller = require('../controllers/studentController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/', asyncHandler(controller.dashboard));
router.get('/courses', asyncHandler(controller.courses));
router.get('/courses/:enrollmentId', asyncHandler(controller.course));
router.get('/schedule', asyncHandler(controller.schedule));
router.get('/payments', asyncHandler(controller.payments));
router.get('/profile', asyncHandler(controller.profile));
router.post('/profile', asyncHandler(controller.updateProfile));
router.post('/profile/password', asyncHandler(controller.updatePassword));
module.exports = router;
