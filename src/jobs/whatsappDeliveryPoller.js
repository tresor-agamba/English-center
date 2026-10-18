const { POLL_INTERVAL_MS, createWhatsAppDeliveryPoller } = require('./whatsappWorkerControl');
module.exports = { POLL_INTERVAL_MS, createWhatsAppDeliveryPoller, ...createWhatsAppDeliveryPoller() };
