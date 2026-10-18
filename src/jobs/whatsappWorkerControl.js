const { getWhatsAppConfig } = require('../config/whatsappConfig');
const logger = require('../services/loggerService');
const POLL_INTERVAL_MS = 10_000;
function createWhatsAppDeliveryPoller({ configProvider = getWhatsAppConfig, environment = () => process.env.NODE_ENV,
  loadProcessors = () => [require('../services/whatsappDeliveryService'), require('../services/whatsappConversationDeliveryService'),
    require('../services/whatsappProspectFollowUpService')], schedule = setInterval, cancel = clearInterval,
  onError = error => logger.error('WHATSAPP_DELIVERY_POLL_FAILED', { error }) } = {}) {
  let timer = null, running = false;
  function allowed() {
    const config = configProvider();
    return environment() !== 'test' && config.enabled === true && config.workersEnabled === true;
  }
  async function runOnce() {
    if (running || !allowed()) return [];
    running = true;
    try {
      configProvider(process.env, { requireValid: true });
      const results = [];
      for (const processor of loadProcessors()) {
        if (!allowed()) break;
        results.push(...await processor.processPending());
      }
      return results;
    } finally { running = false; }
  }
  function start() {
    if (timer || !allowed()) return false;
    timer = schedule(() => runOnce().catch(onError), POLL_INTERVAL_MS);
    timer.unref?.();
    runOnce().catch(onError);
    return true;
  }
  function stop() { if (timer) cancel(timer); timer = null; }
  return { runOnce, start, stop };
}
module.exports = { POLL_INTERVAL_MS, createWhatsAppDeliveryPoller };
