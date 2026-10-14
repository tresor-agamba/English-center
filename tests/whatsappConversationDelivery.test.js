const test = require('node:test');
const assert = require('node:assert/strict');
const cloudApi = require('../src/services/whatsappCloudApiService');
const { createWhatsAppConversationDeliveryService, STALE_MS } = require('../src/services/whatsappConversationDeliveryService');

function makeClient({ status = 'QUEUED', conversationState = 'BOT_ACTIVE', lastMessageAt = new Date('2026-01-01T00:00:00Z'), attempts = 0 } = {}) {
  const message = { id: 1, conversationId: 7, direction: 'OUTBOUND', deliveryStatus: status, attempts, providerMessageId: null, failureCode: null, body: 'Bonjour', idempotencyKey: 'wa-reply:in-1:0', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'), conversation: { id: 7, phoneNumber: '+243812345678', controlState: conversationState, lastMessageAt, engineState: {} } };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'attempts' && value?.lt != null) return row.attempts < value.lt;
    if (key === 'updatedAt' && value?.lt) return row.updatedAt < value.lt;
    if (key === 'updatedAt' && value?.lte) return row.updatedAt <= value.lte;
    return row[key] === value;
  });
  const apply = (row, data) => { for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value; };
  return {
    message,
    whatsAppConversationMessage: {
      findFirst: async () => ({ providerTimestamp: lastMessageAt }),
      updateMany: async ({ where, data }) => { if (!matches(message, where)) return { count: 0 }; apply(message, data); return { count: 1 }; },
      findUnique: async ({ where, include }) => {
        if (where.idempotencyKey) return message.idempotencyKey === where.idempotencyKey ? message : null;
        if (where.providerMessageId) return message.providerMessageId === where.providerMessageId ? message : null;
        return where.id === message.id ? message : null;
      },
      findMany: async ({ where }) => matches(message, where) ? [{ id: message.id }] : [],
      update: async ({ where, data }) => { assert.equal(where.id, message.id); apply(message, data); return message; },
    },
  };
}

const configProvider = () => ({ enabled: true, fakeMode: false, maxAttempts: 3, batchSize: 10 });

test('text payload correlates Cloud API status callbacks and fake transport never makes a request', async () => {
  assert.deepEqual(cloudApi.buildTextPayload({ phoneNumber: '+243812345678', text: 'Bonjour', idempotencyKey: 'reply-1' }), {
    messaging_product: 'whatsapp', to: '243812345678', type: 'text', text: { body: 'Bonjour', preview_url: false }, biz_opaque_callback_data: 'reply-1',
  });
  let called = false;
  const result = await cloudApi.sendTextMessage({ phoneNumber: '+243812345678', text: 'Bonjour' }, { config: { fakeMode: true }, fetchImpl: async () => { called = true; } });
  assert.match(result.providerMessageId, /^fake-/);
  assert.equal(called, false);
});

test('Cloud API transport retries only explicit rate limits and marks server errors uncertain', async () => {
  const config = { fakeMode: false, graphApiVersion: 'v23.0', phoneNumberId: 'test-phone-id', accessToken: 'test-token' };
  const response = (status) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ error: { code: status } }) });
  await assert.rejects(cloudApi.sendTextMessage({ phoneNumber: '+243812345678', text: 'Bonjour' }, { config, fetchImpl: async () => response(429) }), (error) => error.retryable === true && error.code === '429');
  await assert.rejects(cloudApi.sendTextMessage({ phoneNumber: '+243812345678', text: 'Bonjour' }, { config, fetchImpl: async () => response(503) }), (error) => error.retryable === false && error.uncertain === true);
  await assert.rejects(cloudApi.sendTextMessage({ phoneNumber: '+243812345678', text: 'Bonjour' }, { config, fetchImpl: async () => { throw new TypeError('offline'); } }), (error) => error.retryable === false && error.code === 'DELIVERY_UNCERTAIN');
});

test('claims a queued reply once and stores the accepted provider id', async () => {
  const client = makeClient();
  let sends = 0;
  const service = createWhatsAppConversationDeliveryService({ client, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async ({ idempotencyKey }) => { sends += 1; assert.equal(idempotencyKey, 'wa-reply:in-1:0'); return { providerMessageId: 'wamid.1' }; } });
  assert.deepEqual(await service.processPending(), [{ accepted: true }]);
  assert.equal(client.message.deliveryStatus, 'ACCEPTED');
  assert.equal(client.message.providerMessageId, 'wamid.1');
  assert.deepEqual(await service.sendMessage(1), { skipped: true });
  assert.equal(sends, 1);
});

test('cancels queued replies after handoff and rejects replies outside the service window', async () => {
  const handedOff = makeClient({ conversationState: 'HUMAN_TAKEOVER' });
  let sends = 0;
  const service = createWhatsAppConversationDeliveryService({ client: handedOff, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async () => { sends += 1; } });
  assert.deepEqual(await service.processPending(), [{ cancelled: true }]);
  assert.equal(handedOff.message.deliveryStatus, 'CANCELLED');
  assert.equal(sends, 0);

  const optedOut = makeClient({ conversationState: 'OPTED_OUT' });
  const optOutService = createWhatsAppConversationDeliveryService({ client: optedOut, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async () => { sends += 1; } });
  assert.deepEqual(await optOutService.processPending(), [{ cancelled: true }]);
  assert.equal(optedOut.message.deliveryStatus, 'CANCELLED');

  const expired = makeClient({ lastMessageAt: new Date('2025-12-30T00:00:00Z') });
  const expiredService = createWhatsAppConversationDeliveryService({ client: expired, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async () => { sends += 1; } });
  assert.deepEqual(await expiredService.processPending(), [{ failed: true, retryable: false }]);
  assert.equal(expired.message.failureCode, 'CUSTOMER_SERVICE_WINDOW_EXPIRED');
  assert.equal(sends, 0);
});

test('retries an explicit 429 after backoff but marks ambiguous delivery failures terminal', async () => {
  const limited = makeClient();
  const service = createWhatsAppConversationDeliveryService({ client: limited, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async () => { throw Object.assign(new Error('limited'), { retryable: true, acceptanceRejected: true, code: '429' }); } });
  assert.deepEqual(await service.processPending(), [{ failed: true, retryable: true }]);
  assert.equal(limited.message.deliveryStatus, 'QUEUED');
  assert.equal(limited.message.updatedAt.getTime(), new Date('2026-01-01T00:02:00Z').getTime());

  const ambiguous = makeClient();
  const uncertain = createWhatsAppConversationDeliveryService({ client: ambiguous, configProvider, now: () => new Date('2026-01-01T00:01:00Z'), sender: async () => { throw Object.assign(new Error('timeout'), { code: 'DELIVERY_UNCERTAIN', uncertain: true }); } });
  assert.deepEqual(await uncertain.processPending(), [{ failed: true, retryable: false }]);
  assert.equal(ambiguous.message.deliveryStatus, 'FAILED');
  assert.equal(ambiguous.message.failureCode, 'DELIVERY_UNCERTAIN');
});

test('recovery marks a stale processing reply uncertain and callback status advances monotonically', async () => {
  const stale = makeClient({ status: 'PROCESSING', lastMessageAt: new Date('2026-01-01T00:00:00Z') });
  stale.message.updatedAt = new Date(Date.now() - STALE_MS - 1000);
  const service = createWhatsAppConversationDeliveryService({ client: stale, configProvider, now: () => new Date(), sender: async () => { throw new Error('must not send'); } });
  await service.recoverAbandoned();
  assert.equal(stale.message.deliveryStatus, 'FAILED');
  assert.equal(stale.message.failureCode, 'DELIVERY_UNCERTAIN');

  const pending = makeClient();
  const callbackService = createWhatsAppConversationDeliveryService({ client: pending, configProvider });
  assert.equal(await callbackService.applyStatus({ id: 'wamid.2', status: 'delivered', biz_opaque_callback_data: pending.message.idempotencyKey, timestamp: '1767225660' }), true);
  assert.equal(pending.message.deliveryStatus, 'DELIVERED');
  assert.equal(pending.message.providerMessageId, 'wamid.2');
  await callbackService.applyStatus({ id: 'wamid.2', status: 'sent' });
  assert.equal(pending.message.deliveryStatus, 'DELIVERED');
});
