const { createHash } = require('node:crypto');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v, max = 512) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
function invalid() { throw Object.assign(new Error('Invalid Gupshup V2 event.'), { code: 'GUPSHUP_INVALID_EVENT', statusCode: 400 }); }
function canonicalJson(value, depth = 0) {
  if (depth > 32) invalid();
  if (Array.isArray(value)) return '[' + value.map(v => canonicalJson(v, depth + 1)).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k], depth + 1)).join(',') + '}';
  return JSON.stringify(value);
}
function normalizeGupshupEvent(input, { applicationKey, appName, receivedAt } = {}) {
  if (!string(applicationKey, 128) || !string(appName, 128) || !(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) invalid();
  let wire, payload;
  try { wire = JSON.stringify(input); if (Buffer.byteLength(wire) > 1024 * 1024) invalid(); payload = JSON.parse(wire); }
  catch { invalid(); }
  if (!object(payload) || payload.version !== 2 || payload.app !== appName || !string(payload.type, 64) || !object(payload.payload)) invalid();
  let occurredAt = null;
  if (payload.timestamp !== undefined) {
    if (!Number.isSafeInteger(payload.timestamp) || payload.timestamp <= 0 || !Number.isFinite(new Date(payload.timestamp).getTime())) invalid();
    occurredAt = new Date(payload.timestamp);
  }
  const event = { provider: 'gupshup', applicationKey, kind: 'unsupported', externalIds: {},
    receivedAt: new Date(receivedAt), occurredAt, occurredAtSource: occurredAt ? 'gupshup-envelope-ms' : null,
    deduplicationKey: createHash('sha256').update(canonicalJson(payload)).digest('hex'), data: { eventType: payload.type } };
  const p = payload.payload;
  const seconds = occurredAt && occurredAt <= receivedAt ? String(Math.floor(occurredAt.getTime() / 1000)) : undefined;
  if (payload.type === 'message') {
    if (!string(p.id) || typeof p.source !== 'string' || !/^\+?[1-9]\d{6,14}$/.test(p.source) || !string(p.type, 64)) invalid();
    event.externalIds.whatsapp = p.id;
    let message = { id: p.id, from: p.source.replace(/^\+/, ''), type: p.type };
    if (seconds) message.timestamp = seconds;
    if (p.type === 'text') {
      if (!object(p.payload) || !string(p.payload.text, 4000)) invalid();
      message.text = { body: p.payload.text };
    } else if (['button_reply', 'list_reply', 'quick_reply'].includes(p.type)) {
      if (!object(p.payload)) invalid();
      const title = p.type === 'quick_reply' ? p.payload.text : p.payload.title;
      if (!string(title, 4000)) invalid();
      message = { ...message, type: 'interactive', interactive: {
        [p.type === 'list_reply' ? 'list_reply' : 'button_reply']: { title },
      } };
    } else {
      event.sourcePayload = payload; return event;
    }
    event.kind = 'inbound'; event.data = message;
  } else if (payload.type === 'message-event') {
    if (!string(p.id) || !string(p.type, 64) || (p.gsId !== undefined && !string(p.gsId))) invalid();
    if (['sent', 'delivered', 'read'].includes(p.type)) {
      event.externalIds.whatsapp = p.id;
      if (p.gsId) event.externalIds.gupshup = p.gsId;
    } else if (p.type === 'failed') {
      event.externalIds.gupshup = p.gsId || p.id;
      if (p.gsId) event.externalIds.whatsapp = p.id;
    } else if (p.type === 'enqueued') {
      event.externalIds.gupshup = p.id;
      if (p.payload?.whatsappMessageId !== undefined) {
        if (!string(p.payload.whatsappMessageId)) invalid();
        event.externalIds.whatsapp = p.payload.whatsappMessageId;
      }
      event.kind = 'transport'; event.data = { eventType: 'enqueued' }; return event;
    } else { event.sourcePayload = payload; return event; }
    event.kind = 'status'; event.data = { status: p.type };
    if (p.payload?.ts !== undefined) {
      if (!Number.isSafeInteger(p.payload.ts) || p.payload.ts <= 0 || !Number.isFinite(new Date(p.payload.ts * 1000).getTime())) invalid();
      event.data.timestamp = String(p.payload.ts);
      event.occurredAt = new Date(p.payload.ts * 1000); event.occurredAtSource = 'meta-status-seconds';
    } else if (seconds) event.data.timestamp = seconds;
    if (p.type === 'failed') {
      if (!object(p.payload) || !['string', 'number'].includes(typeof p.payload.code) || !/^[a-zA-Z0-9_-]{1,64}$/.test(String(p.payload.code))) invalid();
      event.data.errors = [{ code: `GUPSHUP_${p.payload.code}` }];
    }
  } else event.sourcePayload = payload;
  return event;
}
module.exports = { normalizeGupshupEvent };
