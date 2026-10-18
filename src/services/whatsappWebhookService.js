const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const conversations = require('./whatsappConversationService');
const conversationDeliveries = require('./whatsappConversationDeliveryService');
const prospectFollowUps = require('./whatsappProspectFollowUpService');
const notificationDeliveries = require('./whatsappDeliveryService');
const logger = require('./loggerService');
const knownStatuses = ['sent', 'delivered', 'read', 'failed'];
const safeProviderCode = value => /^(?:0|[1-9]\d{0,9})$/.test(String(value)) ? String(value) : 'UNSPECIFIED';
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
            // A well-formed future status is unsupported, not falsely applied.
            if (!nonempty(item.status) || item.status.length > 64) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
            if (item.biz_opaque_callback_data !== undefined && (typeof item.biz_opaque_callback_data !== 'string'
              || !item.biz_opaque_callback_data.length || item.biz_opaque_callback_data.length > 512)) throw rejection(400, 'WHATSAPP_INVALID_PAYLOAD');
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
async function applyStatus(item, { detailed = false } = {}) {
  let result = { outcome: 'invalid' };
  if (knownStatuses.includes(item?.status) && nonempty(item?.id)) {
    result = { outcome: 'uncorrelated' };
    for (const service of [conversationDeliveries, prospectFollowUps, notificationDeliveries]) {
      const observed = await service.applyStatus(item, { detailed: true });
      // A legacy/injected boolean true proves handling, not that a row changed.
      result = observed === true ? { outcome: 'ignored', reason: 'LEGACY_HANDLED' }
        : observed === false ? { outcome: 'uncorrelated' } : observed;
      if (!['applied', 'ignored', 'uncorrelated', 'invalid'].includes(result?.outcome)) throw rejection(500, 'WHATSAPP_INVALID_HANDLER_RESULT');
      if (result.outcome !== 'uncorrelated') break;
    }
  }
  return detailed ? result : ['applied', 'ignored'].includes(result.outcome);
}
async function handleInbound(message) {
  return conversations.processInboundMessage(message);
}
function createPayloadProcessor({ statusHandler = applyStatus, inboundHandler = handleInbound, observe = logger.warn } = {}) {
  return async function processPayload(payload) {
    const summary = { received: 0, applied: 0, uncorrelated: 0, invalid: 0, unsupported: 0,
      statusesReceived: 0, statuses: 0, statusesIgnored: 0, inbound: 0, duplicates: 0, queuedResponses: 0, providerErrors: 0 };
    for (const entry of payload?.entry || []) for (const change of entry.changes || []) {
      for (const status of change.value?.statuses || []) {
        summary.received++; summary.statusesReceived++;
        if (!nonempty(status?.id) || !nonempty(status?.status) || !timestampValid(status.timestamp)) { summary.invalid++; continue; }
        if (!knownStatuses.includes(status.status)) { summary.unsupported++; continue; }
        const result = await statusHandler(status, { detailed: true });
        if (result?.outcome === 'applied') { summary.statuses++; summary.applied++; }
        else if (result?.outcome === 'ignored' || result === true) summary.statusesIgnored++;
        else if (result?.outcome === 'uncorrelated' || result === false) summary.uncorrelated++;
        else if (result?.outcome === 'invalid') summary.invalid++;
        else throw rejection(500, 'WHATSAPP_INVALID_HANDLER_RESULT');
      }
      for (const message of change.value?.messages || []) {
        summary.received++;
        if (!['text', 'interactive', 'image', 'audio', 'video', 'document', 'sticker'].includes(message?.type)) { summary.unsupported++; continue; }
        const result = await inboundHandler(message);
        if (!result.ignored) summary.inbound++;
        if (result.duplicate) summary.duplicates++;
        else if (!result.ignored) summary.applied++;
        summary.queuedResponses += result.queuedResponses || 0;
      }
      for (const error of change.value?.errors || []) {
        summary.received++; summary.providerErrors++;
        // Numeric code only: no message, details, recipient, URL, trace, or body.
        observe('WHATSAPP_PROVIDER_EVENT_ERROR', { providerCode: safeProviderCode(error?.code) });
      }
    }
    if (summary.uncorrelated || summary.unsupported || summary.invalid) observe('WHATSAPP_EVENTS_UNRESOLVED', {
      uncorrelated: summary.uncorrelated, unsupported: summary.unsupported, invalid: summary.invalid,
    });
    return summary;
  };
}
const processPayload = createPayloadProcessor();
module.exports = { verifySignature, validatePayload, createWebhookReceiver, createPayloadProcessor, processRequest: createWebhookReceiver(), applyStatus, processPayload };
