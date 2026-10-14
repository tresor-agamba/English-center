const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const conversations = require('./whatsappConversationService');
const conversationDeliveries = require('./whatsappConversationDeliveryService');
const prospectFollowUps = require('./whatsappProspectFollowUpService');
const notificationDeliveries = require('./whatsappDeliveryService');
function verifySignature(rawBody, header, config = getWhatsAppConfig()) {
  const secret = config.appSecret;
  if (!config.enabled || typeof secret !== 'string' || !secret.trim()) return false;
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(header)) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  let actual; try { actual = Buffer.from(header.slice(7), 'hex'); } catch { return false; }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function rejection(statusCode, code) {
  return Object.assign(new Error('Événement WhatsApp refusé.'), { statusCode, code });
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const timestampValid = value => value === undefined || (typeof value === 'string' && /^\d+$/.test(value) && Number.isFinite(new Date(Number(value) * 1000).getTime()));

// Validate the entire batch before any handler can persist a message or status.
function validatePayload(payload, config) {
  if (!record(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry) || !payload.entry.length) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
  for (const entry of payload.entry) {
    if (!record(entry) || !nonempty(entry.id) || !Array.isArray(entry.changes) || !entry.changes.length) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
    if (entry.id !== config.businessAccountId) throw rejection(403, 'WHATSAPP_ACCOUNT_MISMATCH');
    for (const change of entry.changes) {
      const value = change?.value;
      if (!record(change) || change.field !== 'messages' || !record(value) || value.messaging_product !== 'whatsapp' || !record(value.metadata) || !nonempty(value.metadata.phone_number_id)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
      if (value.metadata.phone_number_id !== config.phoneNumberId) throw rejection(403, 'WHATSAPP_ACCOUNT_MISMATCH');
      let events = 0;
      for (const key of ['messages', 'statuses', 'errors']) {
        if (value[key] === undefined) continue;
        if (!Array.isArray(value[key])) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
        events += value[key].length;
        for (const item of value[key]) {
          if (!record(item)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
          if (key === 'errors') continue;
          if (!nonempty(item.id) || !timestampValid(item.timestamp)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
          if (key === 'statuses') {
            if (!['sent', 'delivered', 'read', 'failed'].includes(item.status)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
          } else {
            if (typeof item.from !== 'string' || !/^[1-9]\d{6,14}$/.test(item.from) || !nonempty(item.type)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
            if (item.type === 'text' && (!record(item.text) || !nonempty(item.text.body))) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
            if (item.type === 'interactive' && (!record(item.interactive) || !nonempty(item.interactive.button_reply?.title || item.interactive.list_reply?.title))) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
          }
        }
      }
      if (!events) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
    }
  }
}

function createWebhookReceiver({ configProvider = getWhatsAppConfig, processor = processPayload } = {}) {
  return async function processRequest(rawBody, signature) {
    const config = configProvider();
    if (!config.enabled) throw rejection(403, 'WHATSAPP_DISABLED');
    if (!verifySignature(rawBody, signature, config)) throw rejection(401, 'WHATSAPP_INVALID_SIGNATURE');
    try { configProvider(process.env, { requireValid: true }); }
    catch { throw rejection(503, 'WHATSAPP_INVALID_CONFIGURATION'); }
    if (!config.phoneNumberId || !config.businessAccountId) throw rejection(503, 'WHATSAPP_INVALID_CONFIGURATION');
    let payload;
    try { payload = JSON.parse(rawBody.toString('utf8')); }
    catch { throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD'); }
    validatePayload(payload, config);
    return processor(payload);
  };
}
async function applyStatus(item) {
  const map = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }, next = map[item.status];
  if (!next || !item.id) return false;
  if (await conversationDeliveries.applyStatus(item)) return true;
  if (await prospectFollowUps.applyStatus(item)) return true;
  return notificationDeliveries.applyStatus(item);
}
async function handleInbound(message) {
  return conversations.processInboundMessage(message);
}
async function processPayload(payload) {
  let statuses = 0;
  let inbound = 0;
  let duplicates = 0;
  let queuedResponses = 0;
  for (const entry of payload?.entry || []) for (const change of entry.changes || []) {
    for (const status of change.value?.statuses || []) { await applyStatus(status); statuses += 1; }
    for (const message of change.value?.messages || []) {
      const result = await handleInbound(message);
      if (!result.ignored) inbound += 1;
      if (result.duplicate) duplicates += 1;
      queuedResponses += result.queuedResponses || 0;
    }
  }
  return { statuses, inbound, duplicates, queuedResponses };
}
module.exports = { verifySignature, validatePayload, createWebhookReceiver, processRequest: createWebhookReceiver(), applyStatus, processPayload };
