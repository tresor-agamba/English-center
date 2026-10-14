const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { providerPhoneNumber } = require('../utils/phoneNumber');
function buildTemplatePayload({ phoneNumber, templateName, templateLanguage, templateParameters = [], idempotencyKey }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to || !/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) throw Object.assign(new Error('Paramètres WhatsApp invalides.'), { retryable: false, code: 'INVALID_PARAMETERS' });
  const parameters = templateParameters.map(text => ({ type: 'text', text: String(text).slice(0, 500) }));
  return { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: templateLanguage }, ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}) }, ...(idempotencyKey ? { biz_opaque_callback_data: String(idempotencyKey).slice(0, 512) } : {}) };
}
function buildTextPayload({ phoneNumber, text, idempotencyKey }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to || typeof text !== 'string' || !text.trim() || text.length > 4096) throw Object.assign(new Error('Paramètres WhatsApp invalides.'), { retryable: false, code: 'INVALID_PARAMETERS' });
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false }, ...(idempotencyKey ? { biz_opaque_callback_data: String(idempotencyKey).slice(0, 512) } : {}) };
}
async function sendPayload(payload, options = {}) {
  const config = options.config || getWhatsAppConfig(process.env, { requireValid: true });
  if (config.fakeMode) return { providerMessageId: `fake-${crypto.randomUUID()}` };
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    let body = {}; try { body = await response.json(); } catch {}
    const messageId = body?.messages?.[0]?.id;
    if (!response.ok || typeof messageId !== 'string' || !messageId.trim()) {
      const code = String(body?.error?.code || response.status || 'PROVIDER_ERROR');
      const error = new Error('Envoi WhatsApp refusé par le fournisseur.'); error.code = code;
      // Only an explicit rate-limit response confirms rejection. Other HTTP/network
      // failures may happen after acceptance, so automatic retries could duplicate.
      error.acceptanceRejected = !response.ok && response.status >= 400 && response.status < 500;
      error.retryable = error.acceptanceRejected && response.status === 429;
      error.uncertain = !error.acceptanceRejected;
      throw error;
    }
    return { providerMessageId: messageId };
  } catch (error) {
    if (error.uncertain === undefined) { error.retryable = false; error.uncertain = true; error.code = 'DELIVERY_UNCERTAIN'; }
    throw error;
  } finally { clearTimeout(timeout); }
}
async function sendTemplateMessage(data, options = {}) { return sendPayload(buildTemplatePayload(data), options); }
async function sendTextMessage(data, options = {}) { return sendPayload(buildTextPayload(data), options); }
module.exports = { buildTemplatePayload, buildTextPayload, sendTemplateMessage, sendTextMessage };
