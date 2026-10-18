const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhatsAppDeliveryService } = require('../src/services/whatsappDeliveryService');
const { createWhatsAppConversationDeliveryService } = require('../src/services/whatsappConversationDeliveryService');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const cloud = require('../src/services/whatsappCloudApiService');

const config = { enabled: true, maxAttempts: 3, batchSize: 10,
  prospectFollowUp24hTemplate: 'followup', prospectFollowUp72hTemplate: 'followup72' };
const kinds = [
  { name: 'notification', model: 'whatsAppDelivery', field: 'status', pending: 'PENDING', factory: createWhatsAppDeliveryService, send: 'sendDelivery', recover: 'recoverAbandonedDeliveries' },
  { name: 'conversation', model: 'whatsAppConversationMessage', field: 'deliveryStatus', pending: 'QUEUED', factory: createWhatsAppConversationDeliveryService, send: 'sendMessage', recover: 'recoverAbandoned' },
  { name: 'prospect', model: 'whatsAppProspectFollowUp', field: 'status', pending: 'PENDING', factory: createWhatsAppProspectFollowUpService, send: 'sendFollowUp', recover: 'recoverAbandoned' },
];
// In-memory atomic updateMany with detached reads, like Prisma's result objects.
function matches(row, where) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return condition.some(option => matches(row, option));
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('not' in condition && row[key] === condition.not) return false;
      if ('lt' in condition && !(row[key] < condition.lt)) return false;
      if ('lte' in condition && !(row[key] !== null && row[key] <= condition.lte)) return false;
      if ('in' in condition && !condition.in.includes(row[key])) return false;
      return true;
    }
    return row[key] === condition;
  });
}
function setup(kind, { sender, state, attempts = 0, inboundAge = 60_000, inbound = true, configOverride = {} } = {}) {
  let clock = new Date('2026-10-14T12:00:00Z');
  let sends = 0, failAcceptanceWrite = false;
  let beforeUpdate = null, beforeRead = null;
  const conversation = { id: 7, phoneNumber: '+243812345678', controlState: 'BOT_ACTIVE', engineState: {}, lastMessageAt: clock };
  const row = { id: 1, notificationId: 2, userId: 3, conversationId: 7, consentEventId: 5,
    direction: 'OUTBOUND', [kind.field]: state || kind.pending, attempts, providerMessageId: null, failureCode: null,
    failureReason: null, phoneNumber: conversation.phoneNumber, templateName: 'followup', templateLanguage: 'fr', templateParameters: [],
    body: 'Bonjour', deduplicationKey: 'notification-1', idempotencyKey: 'reply-1',
    createdAt: clock, updatedAt: clock, scheduledFor: clock, processingStartedAt: null, conversation };
  const inbounds = inbound ? [{ id: 9, conversationId: 7, direction: 'INBOUND', providerTimestamp: new Date(clock - inboundAge) }] : [];
  const model = {
    async updateMany({ where, data }) {
      if (beforeUpdate) await beforeUpdate(where, data);
      if (failAcceptanceWrite && data[kind.field] === 'ACCEPTED') { failAcceptanceWrite = false; throw Object.assign(new Error('database write unavailable'), { code: 'P1001' }); }
      if (!matches(row, where)) return { count: 0 };
      for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
      if (!data.updatedAt) row.updatedAt = clock;
      return { count: 1 };
    },
    async findUnique({ where }) {
      const result = matches(row, where) ? structuredClone(row) : null;
      if (beforeRead) await beforeRead(where);
      return result;
    },
    async findMany({ where }) { return matches(row, where) ? [structuredClone(row)] : []; },
    async findFirst({ where }) {
      return structuredClone(inbounds.filter(item => matches(item, where)).sort((a, b) => b.providerTimestamp - a.providerTimestamp)[0] || null);
    },
  };
  const client = { [kind.model]: model,
    notification: { findUnique: async () => ({ type: 'PAYMENT_REQUIRED', relatedEntity: null }) },
    whatsAppCommercialConsentEvent: { findFirst: async () => ({ id: 5, decision: 'GRANTED' }) },
    user: { findMany: async () => [] }, enrollment: { findFirst: async () => null } };
  const options = { client, configProvider: () => ({ ...config, ...configOverride }), now: () => clock,
    preferences: { canReceiveWhatsApp: async () => ({ phoneNumber: conversation.phoneNumber }) },
    sender: async (...args) => { sends += 1; return sender ? sender(...args) : { providerMessageId: 'wamid.accepted' }; } };
  const service = kind.factory(options);
  return { service, client, row, inbounds, model, options, sends: () => sends,
    advance: ms => { clock = new Date(clock.getTime() + ms); },
    failAcceptance: () => { failAcceptanceWrite = true; },
    onUpdate: callback => { beforeUpdate = callback; }, onRead: callback => { beforeRead = callback; },
    send: () => service[kind.send](1), callback: status => service.applyStatus({ id: 'wamid.accepted', status, biz_opaque_callback_data: kind.name === 'conversation' ? row.idempotencyKey : row.deduplicationKey }),
  };
}
for (const kind of kinds) {
  test(`${kind.name}: accepted send records id, attempt and correlation, never resends`, async () => {
    let correlation;
    const h = setup(kind, { sender: async data => { correlation = data.idempotencyKey; return { providerMessageId: 'wamid.accepted' }; } });
    assert.deepEqual(await h.send(), { accepted: true });
    assert.equal(h.row[kind.field], 'ACCEPTED'); assert.equal(h.row.providerMessageId, 'wamid.accepted');
    assert.equal(h.row.attempts, 1); assert.equal(correlation, kind.name === 'conversation' ? h.row.idempotencyKey : h.row.deduplicationKey);
    await h.service.processPending(); await h.send(); assert.equal(h.sends(), 1);
  });
  test(`${kind.name}: permanent rejection remains FAILED with one attempt`, async () => {
    const h = setup(kind, { sender: async () => { throw Object.assign(new Error('permanent'), { retryable: false, uncertain: false, code: '131026' }); } });
    assert.deepEqual(await h.send(), { failed: true, retryable: false });
    assert.equal(h.row[kind.field], 'FAILED'); assert.equal(h.row.failureCode, '131026');
    h.advance(2_000_000); await h.service.processPending(); await h.send();
    assert.equal(h.sends(), 1); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: confirmed temporary rejection backs off and stops at maximum attempts`, async () => {
    const h = setup(kind, { sender: async () => { throw Object.assign(new Error('rate limited'), { retryable: true, acceptanceRejected: true, uncertain: false, code: '429' }); } });
    assert.deepEqual(await h.send(), { failed: true, retryable: true });
    assert.equal(h.row[kind.field], kind.pending);
    await h.send(); await h.service.processPending(); assert.equal(h.sends(), 1);
    h.advance(59_999); await h.service.processPending(); assert.equal(h.sends(), 1);
    h.advance(1); await h.service.processPending(); assert.equal(h.sends(), 2);
    h.advance(299_999); await h.send(); assert.equal(h.sends(), 2);
    h.advance(1); assert.deepEqual(await h.service.processPending(), [{ failed: true, retryable: false }]);
    assert.equal(h.row[kind.field], 'FAILED'); assert.equal(h.row.attempts, 3);
    h.advance(3_000_000); await h.service.processPending(); assert.equal(h.sends(), 3);
  });
  test(`${kind.name}: possible transmitted timeout is terminal until late callback reconciles it`, async () => {
    const h = setup(kind, { sender: async () => { throw Object.assign(new Error('timeout'), { retryable: true, uncertain: true, acceptanceRejected: true, code: '503' }); } });
    assert.deepEqual(await h.send(), { failed: true, retryable: false });
    assert.equal(h.row.failureCode, 'DELIVERY_UNCERTAIN'); assert.equal(h.row[kind.field], 'FAILED');
    h.advance(2_000_000); await h.service.processPending(); await h.send(); assert.equal(h.sends(), 1);
    assert.equal(await h.callback('delivered'), true); assert.equal(h.row[kind.field], 'DELIVERED');
    assert.equal(h.row.failureCode, null); assert.equal(h.row.providerMessageId, 'wamid.accepted');
    await h.service.processPending(); assert.equal(h.sends(), 1); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: unproven retryable exception is uncertain and cannot requeue`, async () => {
    const h = setup(kind, { sender: async () => { throw Object.assign(new Error('unproven'), { retryable: true, code: '429' }); } });
    assert.deepEqual(await h.send(), { failed: true, retryable: false });
    assert.equal(h.row.failureCode, 'DELIVERY_UNCERTAIN'); await h.service.processPending(); assert.equal(h.sends(), 1);
  });
  test(`${kind.name}: interrupted worker is uncertain even at attempt limit and accepts late confirmation`, async () => {
    const h = setup(kind, { state: 'PROCESSING', attempts: 3 });
    h.row.processingStartedAt = new Date('2026-10-14T11:00:00Z'); h.row.updatedAt = h.row.processingStartedAt;
    await h.service.processPending(); assert.equal(h.row[kind.field], 'FAILED');
    assert.equal(h.row.failureCode, 'DELIVERY_UNCERTAIN'); assert.equal(h.sends(), 0); assert.equal(h.row.attempts, 3);
    await h.callback('read'); assert.equal(h.row[kind.field], 'READ'); assert.equal(h.row.attempts, 3);
  });
  test(`${kind.name}: duplicate and reordered callbacks do not downgrade READ`, async () => {
    const h = setup(kind); await h.send();
    await h.callback('read'); await h.callback('read'); await h.callback('delivered'); await h.callback('sent'); await h.callback('failed');
    assert.equal(h.row[kind.field], 'READ'); assert.equal(h.row.failureCode, null); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: concurrent workers atomically claim one send`, async () => {
    const h = setup(kind); const secondWorker = kind.factory(h.options);
    const results = await Promise.all([h.service.processPending(), secondWorker.processPending()]);
    assert.equal(h.sends(), 1); assert.equal(h.row.attempts, 1); assert.equal(h.row[kind.field], 'ACCEPTED');
    assert.equal(results.flat().filter(result => result.accepted).length, 1);
  });
  test(`${kind.name}: cancelled before claim is not sent and does not consume an attempt`, async () => {
    const h = setup(kind, { state: 'CANCELLED' }); await h.service.processPending(); await h.send();
    assert.equal(h.sends(), 0); assert.equal(h.row.attempts, 0); assert.equal(h.row[kind.field], 'CANCELLED');
    await h.callback('sent'); assert.equal(h.row[kind.field], 'CANCELLED');
  });
  test(`${kind.name}: callback before HTTP response is not overwritten by ACCEPTED`, async () => {
    let h;
    h = setup(kind, { sender: async () => { await h.callback('read'); return { providerMessageId: 'wamid.accepted' }; } });
    assert.deepEqual(await h.send(), { accepted: true, statusRecordedByWebhook: true });
    assert.equal(h.row[kind.field], 'READ'); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: accepted HTTP response with failed database write never causes resend`, async () => {
    const h = setup(kind); h.failAcceptance();
    assert.deepEqual(await h.send(), { failed: true, retryable: false });
    assert.equal(h.row[kind.field], 'FAILED'); assert.equal(h.row.failureCode, 'DELIVERY_UNCERTAIN');
    await h.service.processPending(); assert.equal(h.sends(), 1);
    await h.callback('sent'); assert.equal(h.row[kind.field], 'SENT'); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: concurrent READ and SENT callbacks cannot overwrite a stronger state`, async () => {
    const h = setup(kind); await h.send();
    let release; const gate = new Promise(resolve => { release = resolve; }); let reads = 0;
    h.onRead(async where => { if (where.providerMessageId && ++reads <= 2) { if (reads === 2) release(); await gate; } });
    await Promise.all([h.callback('read'), h.callback('sent')]);
    assert.equal(h.row[kind.field], 'READ'); assert.equal(h.row.attempts, 1);
  });
  test(`${kind.name}: different provider id cannot hijack existing correlation`, async () => {
    const h = setup(kind); await h.send();
    await h.service.applyStatus({ id: 'wamid.other', status: 'read', biz_opaque_callback_data: kind.name === 'conversation' ? h.row.idempotencyKey : h.row.deduplicationKey });
    assert.equal(h.row.providerMessageId, 'wamid.accepted'); assert.equal(h.row[kind.field], 'ACCEPTED');
  });
  test(`${kind.name}: delivery proof reconciles a failed provider callback without a new send`, async () => {
    const h = setup(kind); await h.send(); await h.callback('failed');
    assert.equal(h.row[kind.field], 'FAILED');
    await h.callback('delivered'); assert.equal(h.row[kind.field], 'DELIVERED');
    await h.callback('failed'); assert.equal(h.row[kind.field], 'DELIVERED'); assert.equal(h.sends(), 1);
  });
  test(`${kind.name}: disabled channel cannot claim work`, async () => {
    const h = setup(kind, { configOverride: { enabled: false } });
    await h.send(); await h.service.processPending(); assert.equal(h.sends(), 0); assert.equal(h.row.attempts, 0);
  });
}

test('transactional manual retry refuses uncertain, legacy and exhausted failures', async () => {
  for (const scenario of [
    { failureCode: 'DELIVERY_UNCERTAIN', attempts: 1 },
    { failureCode: '503', failureReason: 'Échec permanent.', attempts: 1 },
    { failureCode: '429', failureReason: 'Échec permanent ou tentatives épuisées.', attempts: 3 },
  ]) {
    const h = setup(kinds[0], { state: 'FAILED' }); Object.assign(h.row, scenario);
    await assert.rejects(h.service.retryFailedDelivery(1), { statusCode: 409 });
    assert.equal(h.row.status, 'FAILED'); assert.equal(h.sends(), 0);
  }
});
test('transactional manual retry preserves a known permanent rejection without resetting attempts', async () => {
  const h = setup(kinds[0], { state: 'FAILED', attempts: 1 });
  h.row.failureCode = '131026'; h.row.failureReason = 'Échec permanent ou tentatives épuisées.';
  await h.service.retryFailedDelivery(1); assert.equal(h.row.status, 'PENDING'); assert.equal(h.row.attempts, 1);
  await h.send(); assert.equal(h.row.status, 'ACCEPTED'); assert.equal(h.row.attempts, 2);
});
for (const [name, options] of [
  ['delayed webhook', { inboundAge: 25 * 3600_000 }],
  ['24-hour boundary', { inboundAge: 24 * 3600_000 }],
  ['missing provider timestamp', { inbound: false }],
  ['future provider timestamp', { inboundAge: -3600_000 }],
]) {
  test(`conversation service window: ${name} cannot use recent receipt time`, async () => {
    const h = setup(kinds[1], options); assert.deepEqual(await h.send(), { failed: true, retryable: false });
    assert.equal(h.row.failureCode, 'CUSTOMER_SERVICE_WINDOW_EXPIRED');
    assert.equal(h.row.deliveryStatus, 'FAILED'); assert.equal(h.row.attempts, 1); assert.equal(h.sends(), 0);
  });
}
test('conversation service window: reordered old webhook cannot hide a more recent provider message', async () => {
  const h = setup(kinds[1], { inboundAge: 25 * 3600_000 });
  h.inbounds.push({ id: 10, conversationId: 7, direction: 'INBOUND', providerTimestamp: new Date('2026-10-14T11:00:00Z') });
  assert.deepEqual(await h.send(), { accepted: true }); assert.equal(h.sends(), 1);
});
test('conversation cancelled during preflight is not sent', async () => {
  const h = setup(kinds[1]); let reads = 0;
  h.onRead(async where => { if (where.id && ++reads === 1) h.row.deliveryStatus = 'CANCELLED'; });
  await h.send(); assert.equal(h.sends(), 0); assert.equal(h.row.deliveryStatus, 'CANCELLED');
});

const transportConfig = { enabled: true, fakeMode: false, graphApiVersion: 'v23.0', phoneNumberId: '1001', accessToken: 'isolated-test-token' };
for (const [name, fetchImpl] of [
  ['timeout', async () => { throw Object.assign(new Error('timeout'), { name: 'AbortError' }); }],
  ['unexpected network exception', async () => { throw new Error('connection lost'); }],
  ['server error', async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 503 } }) })],
  ['lost success body', async () => ({ ok: true, status: 200, json: async () => { throw new Error('lost body'); } })],
]) {
  test(`Cloud transport classifies ${name} as uncertain, without a second request`, async () => {
    let requests = 0;
    await assert.rejects(cloud.sendTextMessage({ phoneNumber: '+243812345678', text: 'Bonjour' }, { config: transportConfig,
      fetchImpl: async (...args) => { requests += 1; return fetchImpl(...args); } }), error => error.uncertain === true && error.retryable === false);
    assert.equal(requests, 1);
  });
}
