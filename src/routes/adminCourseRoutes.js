const express = require('express');
const controller = require('../controllers/adminCourseController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/', asyncHandler(controller.index));
router.get('/new', controller.newForm);
router.post('/', asyncHandler(controller.create));
router.get('/:id/edit', asyncHandler(controller.editForm));
router.post('/:id', asyncHandler(controller.update));
router.post('/:id/toggle-published', asyncHandler(controller.togglePublished));
router.post('/:id/archive', asyncHandler(controller.archive));
module.exports = router;
