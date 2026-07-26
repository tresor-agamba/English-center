const router = require('express').Router();
const controller = require('../controllers/whatsappWebhookController');
router.get('/', controller.verify);
router.post('/', controller.receive);
module.exports = router;
