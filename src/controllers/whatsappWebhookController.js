const { getWhatsAppConfig } = require('../config/whatsappConfig');
const service = require('../services/whatsappWebhookService');
const logger = require('../services/loggerService');
function verify(req, res) {
  let config;
  try { config = getWhatsAppConfig(process.env, { requireValid: true }); }
  catch { return res.sendStatus(503); }
  if (config.enabled && config.verifyToken && config.appSecret && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.verifyToken) return res.status(200).send(String(req.query['hub.challenge'] || ''));
  return res.sendStatus(403);
}
async function receive(req, res) {
  try {
    const result = await service.processRequest(req.rawBody, req.get('x-hub-signature-256'));
    logger.info('WHATSAPP_WEBHOOK_RESULT', { received: result.received, applied: result.applied,
      statusesApplied: result.statuses, statusesIgnored: result.statusesIgnored, uncorrelated: result.uncorrelated,
      invalid: result.invalid, unsupported: result.unsupported, providerErrors: result.providerErrors,
      duplicates: result.duplicates, queuedResponses: result.queuedResponses });
    // No durable inbox exists. Ask for redelivery; this is not a storage guarantee.
    // Mixed batches may already have effects: their replay remains idempotent.
    if (result.uncorrelated || result.unsupported || result.invalid) return res.sendStatus(503);
    return res.sendStatus(200);
  } catch (error) {
    logger.warn('WHATSAPP_WEBHOOK_FAILED', { reason: ['WHATSAPP_INVALID_PAYLOAD', 'WHATSAPP_INVALID_SIGNATURE',
      'WHATSAPP_ACCOUNT_MISMATCH', 'WHATSAPP_DISABLED', 'WHATSAPP_INVALID_CONFIGURATION', 'WHATSAPP_STATUS_CONFLICT'].includes(error?.code)
      ? error.code : 'DATABASE_OR_PROCESSING_ERROR', invalid: error?.code === 'WHATSAPP_INVALID_PAYLOAD' ? 1 : 0 });
    if (['WHATSAPP_DISABLED', 'WHATSAPP_INVALID_SIGNATURE', 'WHATSAPP_INVALID_CONFIGURATION', 'WHATSAPP_INVALID_PAYLOAD', 'WHATSAPP_ACCOUNT_MISMATCH'].includes(error?.code)) return res.sendStatus(error.statusCode);
    return res.sendStatus(500);
  }
}
module.exports = { verify, receive };
