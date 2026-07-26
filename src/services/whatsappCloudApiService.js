const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { providerPhoneNumber } = require('../utils/phoneNumber');
function buildTemplatePayload({ phoneNumber, templateName, templateLanguage, templateParameters = [] }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to || !/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) throw Object.assign(new Error('Paramètres WhatsApp invalides.'), { retryable: false, code: 'INVALID_PARAMETERS' });
  return { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: templateLanguage }, components: [{ type: 'body', parameters: templateParameters.map(text => ({ type: 'text', text: String(text).slice(0, 500) })) }] } };
}
async function sendTemplateMessage(data, options = {}) {
  const config = options.config || getWhatsAppConfig(process.env, { requireValid: true });
  const payload = buildTemplatePayload(data);
  if (config.fakeMode) return { providerMessageId: `fake-${crypto.randomUUID()}` };
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    let body = {}; try { body = await response.json(); } catch {}
    if (!response.ok || !body.messages?.[0]?.id) {
      const code = String(body.error?.code || response.status || 'PROVIDER_ERROR');
      const error = new Error('Envoi WhatsApp refusé par le fournisseur.'); error.code = code; error.retryable = response.status === 429 || response.status >= 500; throw error;
    }
    return { providerMessageId: body.messages[0].id };
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) { error.retryable = true; error.code = 'NETWORK_ERROR'; }
    throw error;
  } finally { clearTimeout(timeout); }
}
module.exports = { buildTemplatePayload, sendTemplateMessage };
