const { getWhatsAppConfig } = require('../config/whatsappConfig');
const service = require('../services/whatsappWebhookService');
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
    console.log(`Webhook WhatsApp persisté : ${result.inbound} entrant(s), ${result.duplicates} doublon(s), ${result.queuedResponses} réponse(s) en attente, ${result.statuses} statut(s).`);
    return res.sendStatus(200);
  } catch (error) {
    if (['WHATSAPP_DISABLED', 'WHATSAPP_INVALID_SIGNATURE', 'WHATSAPP_INVALID_CONFIGURATION', 'WHATSAPP_INVALID_PAYLOAD', 'WHATSAPP_ACCOUNT_MISMATCH'].includes(error?.code)) return res.sendStatus(error.statusCode);
    console.error(`Traitement webhook WhatsApp différé : ${String(error?.code || 'DATABASE_OR_PROCESSING_ERROR')}`);
    return res.sendStatus(500);
  }
}
module.exports = { verify, receive };
