const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { providerPhoneNumber } = require('../utils/phoneNumber');
const MAX_CORRELATION_LENGTH = 512;
function localFailure(code) {
  return Object.assign(new Error('Envoi WhatsApp bloque avant transport.'), { code, retryable: false, uncertain: false, acceptanceRejected: true });
}
function correlation(idempotencyKey) {
  if (idempotencyKey === undefined || idempotencyKey === null) return {};
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > MAX_CORRELATION_LENGTH
    || Buffer.byteLength(idempotencyKey, 'utf8') > MAX_CORRELATION_LENGTH) throw localFailure('INVALID_CORRELATION_KEY');
  return { biz_opaque_callback_data: idempotencyKey };
}
function buildTemplatePayload({ phoneNumber, templateName, templateLanguage, templateParameters = [], idempotencyKey }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to || !/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) throw Object.assign(new Error('Paramètres WhatsApp invalides.'), { retryable: false, code: 'INVALID_PARAMETERS' });
  const parameters = templateParameters.map(text => ({ type: 'text', text: String(text).slice(0, 500) }));
  return { messaging_product: 'whatsapp', to, type: 'template', template: { name: templateName, language: { code: templateLanguage }, ...(parameters.length ? { components: [{ type: 'body', parameters }] } : {}) }, ...correlation(idempotencyKey) };
}
function buildTextPayload({ phoneNumber, text, idempotencyKey }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to || typeof text !== 'string' || !text.trim() || text.length > 4096) throw Object.assign(new Error('Paramètres WhatsApp invalides.'), { retryable: false, code: 'INVALID_PARAMETERS' });
  return { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false }, ...correlation(idempotencyKey) };
}
async function sendPayload(payload, options = {}) {
  const config = options.config || getWhatsAppConfig(process.env, { requireValid: true });
  if (config.enabled !== true) throw localFailure('WHATSAPP_DISABLED');
  if (config.fakeMode && process.env.NODE_ENV === 'production') throw localFailure('WHATSAPP_INVALID_CONFIGURATION');
  if (config.fakeMode) return { providerMessageId: `fake-${crypto.randomUUID()}` };
  if (!/^v\d+\.\d+$/.test(config.graphApiVersion || '') || !/^\d+$/.test(config.phoneNumberId || '')
    || typeof config.accessToken !== 'string' || !config.accessToken.trim() || /[\r\n]/.test(config.accessToken)) throw localFailure('WHATSAPP_INVALID_CONFIGURATION');
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw localFailure('WHATSAPP_INVALID_TIMEOUT');
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Transport deadline exceeded.'), { code: 'DELIVERY_UNCERTAIN' })); }, timeoutMs);
  });
  let classifiedError;
  try {
    const fetchImpl = options.fetchImpl || fetch;
    const response = await Promise.race([deadline, Promise.resolve().then(() => fetchImpl(`https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' }))]);
    let body = {}; try { body = await Promise.race([response.json(), deadline]); } catch { /* Missing body is not proof of non-acceptance. */ }
    const messageId = body?.messages?.[0]?.id;
    if (!response.ok || body?.error || typeof messageId !== 'string' || !messageId.trim()) {
      const metaCode = /^(?:0|[1-9]\d{0,9})$/.test(String(body?.error?.code)) ? String(body.error.code) : null;
      const code = metaCode || (/^[1-5]\d\d$/.test(String(response.status)) ? String(response.status) : 'PROVIDER_ERROR');
      const error = new Error('Envoi WhatsApp refusé par le fournisseur.'); error.code = code;
      // Preserve the existing retry policy: confirmed 429 only. No new retry codes.
      // A contradictory message ID, ambiguous 408 or malformed body is unsafe.
      error.acceptanceRejected = !response.ok && response.status >= 400 && response.status < 500 && response.status !== 408
        && metaCode !== null && body?.error !== null && typeof body?.error === 'object' && !Array.isArray(body.error) && !messageId;
      error.retryable = error.acceptanceRejected && response.status === 429;
      error.uncertain = !error.acceptanceRejected;
      error.category = error.uncertain ? 'uncertain' : response.status === 429 ? 'rate_limit'
        : response.status === 401 ? 'authentication' : response.status === 403 ? 'permission' : 'request_rejected';
      error.httpStatus = response.status;
      classifiedError = error;
      throw error;
    }
    return { providerMessageId: messageId };
  } catch (error) {
    if (classifiedError && error === classifiedError) throw error;
    // Never propagate a fetch exception containing a URL, token, or response body.
    throw Object.assign(new Error('Resultat de livraison WhatsApp incertain.'), {
      retryable: false, uncertain: true, acceptanceRejected: false, code: 'DELIVERY_UNCERTAIN', category: 'uncertain',
    });
  } finally { clearTimeout(timeout); }
}
function buildInteractivePayload({ phoneNumber, interactive, idempotencyKey }) {
  const to = providerPhoneNumber(phoneNumber);
  if (!to) throw localFailure('INVALID_PARAMETERS');
  return { messaging_product: 'whatsapp', to, type: 'interactive', interactive: require('./whatsappInteractive').validateInteractive(interactive), ...correlation(idempotencyKey) };
}
async function sendInteractiveMessage(data, options = {}) { return sendPayload(buildInteractivePayload(data), options); }
async function sendConversationMessage(data, options = {}) { return data.interactive ? sendInteractiveMessage(data, options) : sendTextMessage(data, options); }
async function sendTemplateMessage(data, options = {}) { return sendPayload(buildTemplatePayload(data), options); }
async function sendTextMessage(data, options = {}) { return sendPayload(buildTextPayload(data), options); }
module.exports = { buildInteractivePayload, sendInteractiveMessage, sendConversationMessage, MAX_CORRELATION_LENGTH, buildTemplatePayload, buildTextPayload, sendTemplateMessage, sendTextMessage };
