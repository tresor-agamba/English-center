const { getWhatsAppConfig } = require('../config/whatsappConfig');
const service = require('../services/whatsappWebhookService');
function verify(req, res) {
  const config = getWhatsAppConfig();
  if (req.query['hub.mode'] === 'subscribe' && config.verifyToken && req.query['hub.verify_token'] === config.verifyToken) return res.status(200).send(String(req.query['hub.challenge'] || ''));
  return res.sendStatus(403);
}
async function receive(req, res) {
  try {
    if (!service.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200);
    service.processPayload(req.body).then(result => console.log(`Webhook WhatsApp reçu : ${result.statuses} statut(s)`)).catch(error => console.error('Traitement webhook WhatsApp:', error.message));
  } catch { return res.sendStatus(400); }
}
module.exports = { verify, receive };
