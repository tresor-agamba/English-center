const express = require('express');
const controller = require('../controllers/adminClassMeetingController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();
router.get('/', asyncHandler(controller.index));
router.get('/new', asyncHandler(controller.newForm));
router.post('/', asyncHandler(controller.create));
router.get('/:id/attendance', asyncHandler(controller.attendanceForm));
router.post('/:id/attendance', asyncHandler(controller.saveAttendance));
router.get('/:id/edit', asyncHandler(controller.editForm));
router.post('/:id/cancel', asyncHandler(controller.cancel));
router.get('/:id', asyncHandler(controller.show));
router.post('/:id', asyncHandler(controller.update));
module.exports = router;
