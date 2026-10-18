const test = require('node:test');
const assert = require('node:assert/strict');
const { createGupshupSimulation } = require('../src/services/providers/gupshupSimulation');
const { createGupshupTransport } = require('../src/services/providers/gupshupTransport');
const { normalizeGupshupEvent } = require('../src/services/providers/gupshupEventNormalizer');
const { verifyGupshupWebhook } = require('../src/services/providers/gupshupWebhookVerifier');
const { createGupshupMemoryCorrelation } = require('../src/services/providers/gupshupMemoryCorrelation');
const { classifySendError, applyDeliveryStatus } = require('../src/services/whatsappDeliveryPolicy');
const { createWhatsAppConversationDeliveryService } = require('../src/services/whatsappConversationDeliveryService');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const text = { phoneNumber: '+15555550123', text: 'Synthetic fixture', idempotencyKey: 'sim-operation' };
const config = { mode: 'simulation', applicationKey: 'sim-app', appName: 'sim-app', source: '15555550124' };
const template = { applicationKey: 'sim-app', businessTemplateName: 'sim_welcome', language: 'fr',
  providerTemplateId: 'sim-template', enabled: true, approvalStatus: 'APPROVED', parameterNamesInOrder: ['name'] };
const setup = replies => {
  const simulation = createGupshupSimulation(replies);
  return { simulation, adapter: createGupshupTransport({ ...config, simulation, templateCatalog: [template] }) };
};
const now = new Date('2026-10-01T12:00:00Z');
const envelope = (type, payload, timestamp = now.getTime()) => ({ app: 'sim-app', version: 2, type, timestamp, payload });
const normalize = input => normalizeGupshupEvent(input, { applicationKey: 'sim-app', appName: 'sim-app', receivedAt: now });
const statusEvent = (type = 'delivered', extra = {}) => normalize(envelope('message-event', {
  id: 'sim-wa', gsId: 'sim-gs', type, payload: { ts: Math.floor(now.getTime() / 1000) }, ...extra,
}));
const binding = { applicationKey: 'sim-app', submissionId: 'sim-gs', deliveryKind: 'conversation', deliveryId: 1, attemptNumber: 1 };

test('text sender matches NVA contract, form encoding and canonical provider id', async () => {
  const { adapter, simulation } = setup([{ status: 200, body: { status: 'submitted', messageId: 'sim-gs' } }]);
  assert.deepEqual(await adapter.sendTextMessage(text), { providerMessageId: 'gupshup:sim-app:sim-gs' });
  const request = simulation.requests[0];
  assert.equal(new URL(request.url).hostname, 'gupshup.invalid');
  assert.equal(request.headers.apikey, 'simulation-only');
  const form = new URLSearchParams(request.body);
  assert.equal(form.get('destination'), '15555550123');
  assert.equal(form.get('src.name'), 'sim-app');
  assert.deepEqual(JSON.parse(form.get('message')), { type: 'text', text: text.text });
});

for (const status of ['success', 'submitted']) test(`approved template maps id, language and ordered params (${status})`, async () => {
  const { adapter, simulation } = setup([{ status: 202, body: { status, messageId: 'sim-template-gs' } }]);
  await adapter.sendTemplateMessage({ phoneNumber: text.phoneNumber, templateName: 'sim_welcome', templateLanguage: 'fr', templateParameters: ['Fixture'], idempotencyKey: 'sim-template-key' });
  assert.deepEqual(JSON.parse(new URLSearchParams(simulation.requests[0].body).get('template')), { id: 'sim-template', params: ['Fixture'] });
});

test('invalid input/template is rejected before transport, with no fallback', async () => {
  const { adapter, simulation } = setup([]);
  await assert.rejects(adapter.sendTextMessage({ ...text, text: '' }), { code: 'GUPSHUP_INVALID_TEXT' });
  await assert.rejects(adapter.sendTextMessage({ ...text, phoneNumber: 15555550123 }), { code: 'GUPSHUP_INVALID_INPUT' });
  await assert.rejects(adapter.sendTemplateMessage({ ...text, templateName: 'sim_welcome', templateLanguage: 'en', templateParameters: [] }), { code: 'GUPSHUP_INVALID_TEMPLATE' });
  assert.equal(simulation.requests.length, 0);
});

test('transport cannot accept global fetch, arbitrary injected fetch or live mode', () => {
  assert.throws(() => createGupshupTransport({ ...config, mode: 'live', simulation: createGupshupSimulation() }), { code: 'GUPSHUP_SIMULATION_REQUIRED' });
  assert.throws(() => createGupshupTransport({ ...config, simulation: { request: global.fetch } }), { code: 'GUPSHUP_SIMULATION_REQUIRED' });
});

test('concurrent and repeated local operation cannot send twice; conflicting payload rejected', async () => {
  const { adapter, simulation } = setup([{ status: 200, body: { status: 'submitted', messageId: 'sim-gs' } }]);
  const results = await Promise.all([adapter.sendTextMessage(text), adapter.sendTextMessage(text)]);
  assert.deepEqual(results[0], results[1]);
  await adapter.sendTextMessage(text);
  await assert.rejects(adapter.sendTextMessage({ ...text, text: 'Other fixture' }), { code: 'GUPSHUP_IDEMPOTENCY_CONFLICT' });
  assert.equal(simulation.requests.length, 1);
});

for (const code of [400, 401]) test(`permanent ${code} rejection matches delivery policy and is not resent`, async () => {
  const { adapter, simulation } = setup([{ status: code, body: { status: 'error', message: 'Synthetic rejection' } }]);
  for (let i = 0; i < 2; i++) await assert.rejects(adapter.sendTextMessage(text), error => {
    assert.deepEqual(classifySendError(error), { uncertain: false, retryable: false, failureCode: `GUPSHUP_HTTP_${code}` }); return true;
  });
  assert.equal(simulation.requests.length, 1);
});

test('temporary rejection permits a caller-controlled retry but never retries internally', async () => {
  const { adapter, simulation } = setup([{ status: 429, body: { status: 'error', message: 'Synthetic rate limit' } },
    { status: 200, body: { status: 'submitted', messageId: 'sim-retry' } }]);
  await assert.rejects(adapter.sendTextMessage(text), error => classifySendError(error).retryable === true);
  assert.equal(simulation.requests.length, 1);
  await adapter.sendTextMessage(text);
  assert.equal(simulation.requests.length, 2);
});

for (const reply of [{ failure: 'timeout' }, { failure: 'network' }, { status: 500, body: {} },
  { status: 200, body: { status: 'submitted' } }, { status: 200, body: 'invalid JSON' },
  { status: 429, body: { status: 'error', message: 'conflicting', messageId: 'sim-accepted' } }]) {
  test(`uncertain response ${JSON.stringify(reply)} never triggers a duplicate send`, async () => {
    const { adapter, simulation } = setup([reply]);
    for (let i = 0; i < 2; i++) await assert.rejects(adapter.sendTextMessage(text), error => {
      assert.equal(error.code, 'DELIVERY_UNCERTAIN'); assert.equal(classifySendError(error).retryable, false);
      assert.ok(!error.message.includes('conflicting')); return true;
    });
    assert.equal(simulation.requests.length, 1);
  });
}

test('text inbound preserves WhatsApp id and converts milliseconds without inventing consent', () => {
  const e = normalize(envelope('message', { id: 'sim-inbound', source: '15555550123', type: 'text', payload: { text: 'Synthetic input' } }));
  assert.equal(e.kind, 'inbound');
  assert.deepEqual(e.data, { id: 'sim-inbound', from: '15555550123', type: 'text', timestamp: '1790856000', text: { body: 'Synthetic input' } });
  assert.equal(e.occurredAtSource, 'gupshup-envelope-ms');
  assert.equal(e.data.consent, undefined);
});

for (const kind of ['button_reply', 'list_reply', 'quick_reply']) test(`interactive ${kind} has an explicit compatible shape`, () => {
  const e = normalize(envelope('message', { id: 'sim-button', source: '15555550123', type: kind,
    payload: kind === 'quick_reply' ? { text: 'Synthetic choice', postbackText: 'ignored' } : { title: 'Synthetic choice' } }));
  assert.equal(e.data.type, 'interactive');
  assert.equal(e.data.interactive[kind === 'list_reply' ? 'list_reply' : 'button_reply'].title, 'Synthetic choice');
});

test('absent/future timestamps do not manufacture an inbound service window', () => {
  const p = envelope('message', { id: 'sim-inbound', source: '15555550123', type: 'text', payload: { text: 'Fixture' } });
  delete p.timestamp;
  assert.equal(normalize(p).data.timestamp, undefined);
  p.timestamp = now.getTime() + 1000;
  assert.equal(normalize(p).data.timestamp, undefined);
});

for (const mutate of [p => { p.version = 1; }, p => { p.app = 'other-app'; }, p => { p.timestamp = 'invalid'; }, p => { p.payload.source = 15555550123; },
  p => { p.payload.source = 'invalid'; }, p => { p.payload.payload = null; }]) test('invalid V2 payload rejected without side effects', () => {
  const p = envelope('message', { id: 'sim-inbound', source: '15555550123', type: 'text', payload: { text: 'Fixture' } });
  mutate(p); assert.throws(() => normalize(p), { code: 'GUPSHUP_INVALID_EVENT' });
});

test('unknown events are classified and retained; enqueued is not sent', async () => {
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  const event = normalize(envelope('unknown-event', { synthetic: true }));
  const id = store.receive(event);
  assert.equal(await store.process(id), 'RETAINED');
  assert.deepEqual(store.inspect(id).event.sourcePayload.payload, { synthetic: true });
  const queued = normalize(envelope('message-event', { id: 'sim-gs', type: 'enqueued', payload: { whatsappMessageId: 'sim-wa' } }));
  assert.equal(queued.kind, 'transport');
  assert.equal(queued.data.status, undefined);
});

test('every real or apparently authenticated webhook is refused, including test mode', () => {
  for (const headers of [{}, { 'user-agent': 'Gupshup', app: 'sim-app' }, { authorization: 'synthetic' }, { 'x-hub-signature-256': 'synthetic' }]) {
    assert.throws(() => verifyGupshupWebhook({ rawBody: Buffer.from('{}'), headers, trustedTransportContext: { verified: true } }), { code: 'GUPSHUP_WEBHOOK_AUTH_UNAVAILABLE', statusCode: 503 });
  }
});

test('unknown ids and lost HTTP responses stay waiting without guessing', async () => {
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  let applied = 0;
  const id = store.receive(statusEvent());
  assert.equal(await store.process(id, { applyStatus: async () => { applied++; } }), 'WAITING_CORRELATION');
  assert.equal(applied, 0);
  assert.equal(store.inspect(id).event.externalIds.gupshup, 'sim-gs');
});

test('redelivery with reordered JSON properties keeps the same inbox identity', () => {
  const event = envelope('message-event', { id: 'sim-gs', type: 'enqueued', payload: { whatsappMessageId: 'sim-wa' } });
  const reordered = { payload: event.payload, type: event.type, timestamp: event.timestamp, version: 2, app: event.app };
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  assert.equal(store.receive(normalize(event)), store.receive(normalize(reordered)));
});

test('early callback waits for correlation AND binding, then applies once under concurrency', async () => {
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  const event = statusEvent(); const id = store.receive(event);
  assert.equal(store.receive(event), id);
  assert.equal(await store.process(id), 'WAITING_CORRELATION');
  store.bind(binding);
  assert.equal(await store.process(id), 'WAITING_BINDING');
  store.bind({ ...binding, ready: true });
  let calls = 0;
  const applyStatus = async (item, linked) => { calls++; assert.equal(item.id, 'gupshup:sim-app:sim-gs'); assert.equal(linked.deliveryId, 1); return true; };
  await Promise.all([store.process(id, { applyStatus }), store.process(id, { applyStatus })]);
  assert.equal(await store.process(id, { applyStatus }), 'DONE');
  assert.equal(calls, 1);
  const late = statusEvent('read', { gsId: undefined });
  const lateId = store.receive(late);
  assert.equal(await store.process(lateId, { applyStatus }), 'DONE');
});

test('alias conflicts refuse reassignment and isolate applications', async () => {
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  store.bind({ ...binding, whatsappId: 'sim-wa', ready: true });
  assert.throws(() => store.bind({ ...binding, submissionId: 'sim-other', whatsappId: 'sim-wa' }), { code: 'GUPSHUP_ALIAS_CONFLICT' });
  assert.throws(() => store.bind({ ...binding, deliveryId: 2 }), { code: 'GUPSHUP_ALIAS_CONFLICT' });
  const event = statusEvent(); event.applicationKey = 'sim-other-app';
  assert.equal(await store.process(store.receive(event)), 'WAITING_CORRELATION');
});

test('missing local binding or handler failure never discards callback', async () => {
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' });
  store.bind({ ...binding, ready: true }); const id = store.receive(statusEvent());
  assert.equal(await store.process(id, { applyStatus: async () => false }), 'WAITING_BINDING');
  await assert.rejects(store.process(id, { applyStatus: async () => { throw new Error('Synthetic persistence failure'); } }));
  assert.equal(store.inspect(id).state, 'PENDING');
  assert.equal(await store.process(id, { applyStatus: async () => true }), 'DONE');
});

test('normalized callbacks preserve the existing monotone status policy', async () => {
  const row = { id: 1, providerMessageId: 'gupshup:sim-app:sim-gs', deliveryStatus: 'PROCESSING', attempts: 1, failureCode: null };
  const model = { findUnique: async () => ({ ...row }), updateMany: async ({ where, data }) => {
    if (Object.entries(where).every(([k, v]) => row[k] === v)) { Object.assign(row, data); return { count: 1 }; }
    return { count: 0 };
  } };
  const store = createGupshupMemoryCorrelation({ mode: 'simulation' }); store.bind({ ...binding, ready: true });
  for (const status of ['read', 'sent', 'delivered', 'failed']) {
    const event = statusEvent(status, status === 'failed' ? { payload: { code: 1002 } } : {});
    await store.process(store.receive(event), { applyStatus: item => applyDeliveryStatus({ model, item, stateField: 'deliveryStatus', conversation: true, now: () => now }) });
  }
  assert.equal(row.deliveryStatus, 'READ');
});

function memoryModel(row) {
  return {
    findUnique: async () => structuredClone(row),
    updateMany: async ({ where, data }) => {
      const matches = Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && !(value instanceof Date)) {
          if ('lt' in value) return row[key] < value.lt;
          if ('lte' in value) return row[key] <= value.lte;
        }
        return row[key] === value;
      });
      if (!matches) return { count: 0 };
      for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value;
      return { count: 1 };
    },
  };
}

test('existing conversation service can inject simulated sender with one winner and no second send', async () => {
  const { adapter, simulation } = setup([{ status: 200, body: { status: 'submitted', messageId: 'sim-gs' } }]);
  const row = { id: 1, conversationId: 1, direction: 'OUTBOUND', deliveryStatus: 'QUEUED', attempts: 0, updatedAt: now,
    body: text.text, idempotencyKey: text.idempotencyKey, conversation: { phoneNumber: text.phoneNumber, controlState: 'BOT_ACTIVE' } };
  const model = memoryModel(row); model.findFirst = async () => ({ providerTimestamp: new Date(now.getTime() - 1000) });
  const service = createWhatsAppConversationDeliveryService({ client: { whatsAppConversationMessage: model },
    sender: adapter.sendTextMessage, configProvider: () => ({ enabled: true, maxAttempts: 3 }), now: () => now });
  const results = await Promise.all([service.sendMessage(1), service.sendMessage(1)]);
  assert.equal(results.filter(r => r.accepted).length, 1);
  assert.equal(results.filter(r => r.skipped).length, 1);
  assert.deepEqual(await service.sendMessage(1), { skipped: true });
  assert.equal(row.attempts, 1); assert.equal(row.providerMessageId, 'gupshup:sim-app:sim-gs');
  assert.equal(simulation.requests.length, 1);
});

for (const consent of ['GRANTED', 'REVOKED']) test(`existing follow-up service retains consent rule (${consent}) with injected template sender`, async () => {
  const { adapter, simulation } = setup([{ status: 202, body: { status: 'success', messageId: 'sim-template-send' } }]);
  const row = { id: 1, conversationId: 1, consentEventId: 2, status: 'PENDING', attempts: 0, scheduledFor: now,
    templateName: 'sim_welcome', templateLanguage: 'fr', templateParameters: ['Fixture'], deduplicationKey: 'sim-follow-up',
    conversation: { phoneNumber: text.phoneNumber, controlState: 'BOT_ACTIVE' } };
  const client = { whatsAppProspectFollowUp: memoryModel(row), whatsAppCommercialConsentEvent: { findFirst: async () => ({ id: 2, decision: consent }) },
    user: { findMany: async () => [] }, enrollment: { findFirst: async () => null } };
  const service = createWhatsAppProspectFollowUpService({ client, sender: adapter.sendTemplateMessage,
    configProvider: () => ({ enabled: true, maxAttempts: 3, prospectFollowUp24hTemplate: 'sim_welcome', prospectFollowUp72hTemplate: 'sim_other' }), now: () => now });
  assert.deepEqual(await service.sendFollowUp(1), consent === 'GRANTED' ? { accepted: true } : { cancelled: true });
  assert.equal(simulation.requests.length, consent === 'GRANTED' ? 1 : 0);
});
