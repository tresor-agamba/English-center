const { getWhatsAppConfig } = require('../config/whatsappConfig');
const notificationDeliveries = require('../services/whatsappDeliveryService');
const conversationDeliveries = require('../services/whatsappConversationDeliveryService');
const prospectFollowUps = require('../services/whatsappProspectFollowUpService');
const logger = require('../services/loggerService');

const POLL_INTERVAL_MS = 10_000;
let timer = null;
let running = false;

async function runOnce() {
  if (running || !getWhatsAppConfig().enabled) return [];
  running = true;
  try {
    getWhatsAppConfig(process.env, { requireValid: true });
    const notifications = await notificationDeliveries.processPending();
    const conversations = await conversationDeliveries.processPending();
    const followUps = await prospectFollowUps.processPending();
    return [...notifications, ...conversations, ...followUps];
  } finally { running = false; }
}

function start() {
  if (timer || !getWhatsAppConfig().enabled) return false;
  timer = setInterval(() => runOnce().catch((error) => logger.error('WHATSAPP_DELIVERY_POLL_FAILED', { error })), POLL_INTERVAL_MS);
  timer.unref?.();
  runOnce().catch((error) => logger.error('WHATSAPP_DELIVERY_POLL_FAILED', { error }));
  return true;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { POLL_INTERVAL_MS, runOnce, start, stop };
