const express = require('express');
const controller = require('../controllers/adminStudentController');
const asyncHandler = require('../middlewares/asyncHandler');
const limits = require('../middlewares/rateLimits');

const router = express.Router();

router.get('/', asyncHandler(controller.index));
router.get('/new', controller.newForm);
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.show));
router.get('/:id/edit', asyncHandler(controller.editForm));
router.post('/:id', asyncHandler(controller.update));
router.post('/:id/toggle-status', asyncHandler(controller.toggleStatus));
router.post('/:id/reset-password', limits.passwordReset, asyncHandler(controller.resetPassword));

module.exports = router;
