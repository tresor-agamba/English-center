const express = require('express');
const controller = require('../controllers/adminSessionController');
const asyncHandler = require('../middlewares/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(controller.index));
router.get('/new', asyncHandler(controller.newForm));
router.post('/', asyncHandler(controller.create));
router.get('/:id', asyncHandler(controller.show));
router.get('/:id/edit', asyncHandler(controller.editForm));
router.post('/:id', asyncHandler(controller.update));
router.post('/:id/cancel', asyncHandler(controller.cancel));
router.post('/:id/toggle-status', asyncHandler(controller.toggleStatus));
router.post('/:id/groups', asyncHandler(controller.createGroup));
router.post('/:id/groups/:groupId/toggle', asyncHandler(controller.toggleGroup));
router.post('/:id/whatsapp-group', asyncHandler(controller.saveWhatsAppGroup));
router.post('/:id/whatsapp-invitations', asyncHandler(controller.sendWhatsAppInvitations));

module.exports = router;
