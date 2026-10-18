const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const cloud = require('../src/services/whatsappCloudApiService');
const webhook = require('../src/services/whatsappWebhookService');
const controller = require('../src/controllers/whatsappWebhookController');
const logger = require('../src/services/loggerService');
const { applyDeliveryStatus } = require('../src/services/whatsappDeliveryPolicy');
const { getWhatsAppConfig } = require('../src/config/whatsappConfig');
const { createWhatsAppDeliveryPoller } = require('../src/jobs/whatsappDeliveryPoller');
const config = { enabled: true, fakeMode: false, graphApiVersion: 'v23.0', phoneNumberId: '1001',
  businessAccountId: '2001', accessToken: 'synthetic-only', appSecret: 'synthetic-signing', verifyToken: 'synthetic-verify' };
const text = { phoneNumber: '+15555550123', text: 'Synthetic fixture' };
const status = { id: 'wamid.synthetic', status: 'delivered', timestamp: '1791547200' };
const batch = value => ({ object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{ field: 'messages',
  value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, ...value } }] }] });
const response = (httpStatus, body) => ({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json: async () => body });
async function throughController(t, value, processor, validSignature = true) {
  const receiver = webhook.createWebhookReceiver({ configProvider: () => config, processor });
  t.mock.method(webhook, 'processRequest', receiver);
  const logs = [];
  t.mock.method(logger, 'info', (action, data) => logs.push({ action, data }));
  t.mock.method(logger, 'warn', (action, data) => logs.push({ action, data }));
  const rawBody = Buffer.from(JSON.stringify(batch(value)));
  const signature = 'sha256=' + (validSignature ? crypto.createHmac('sha256', config.appSecret).update(rawBody).digest('hex') : '0'.repeat(64));
  let httpStatus;
  await controller.receive({ rawBody, get: () => signature }, { sendStatus: code => { httpStatus = code; } });
  return { httpStatus, logs };
}
test('uncorrelated callback is received, never applied, and requests redelivery without storage claim', async t => {
  const processor = webhook.createPayloadProcessor({ statusHandler: async () => false, observe: () => {} });
  const summary = await processor(batch({ statuses: [status] }));
  assert.equal(summary.received, 1); assert.equal(summary.applied, 0); assert.equal(summary.statuses, 0); assert.equal(summary.uncorrelated, 1);
  const result = await throughController(t, { statuses: [status] }, processor);
  assert.equal(result.httpStatus, 503); assert.equal(result.logs[0].data.applied, 0);
});
test('default status router tries all three circuits and preserves the false contract', async t => {
  const circuits = ['whatsappConversationDeliveryService', 'whatsappProspectFollowUpService', 'whatsappDeliveryService'];
  const mocks = circuits.map(name => t.mock.method(require('../src/services/' + name), 'applyStatus', async (item, options) => {
    assert.equal(options.detailed, true); return { outcome: 'uncorrelated' };
  }));
  assert.equal(await webhook.applyStatus(status), false);
  assert.deepEqual(await webhook.applyStatus(status, { detailed: true }), { outcome: 'uncorrelated' });
  for (const mock of mocks) assert.equal(mock.mock.callCount(), 2);
});
test('detailed policy distinguishes mutation, duplicate, cancellation, invalid and uncorrelated', async () => {
  let row = { id: 1, status: 'ACCEPTED', providerMessageId: status.id, attempts: 1, failureCode: null };
  const model = { findUnique: async () => row && { ...row }, updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; } };
  assert.equal((await applyDeliveryStatus({ model, item: status, detailed: true })).outcome, 'applied');
  assert.equal((await applyDeliveryStatus({ model, item: status, detailed: true })).outcome, 'ignored');
  row.status = 'CANCELLED'; assert.equal((await applyDeliveryStatus({ model, item: status, detailed: true })).outcome, 'ignored');
  assert.equal((await applyDeliveryStatus({ model, item: {}, detailed: true })).outcome, 'invalid');
  assert.equal((await applyDeliveryStatus({ model, item: { id: 'synthetic', status: 'toString' }, detailed: true })).outcome, 'invalid');
  row = null; assert.equal((await applyDeliveryStatus({ model, item: status, detailed: true })).outcome, 'uncorrelated');
  assert.equal(await applyDeliveryStatus({ model, item: status }), false);
});
test('duplicate status is acknowledged but not counted as an applied mutation', async t => {
  const processor = webhook.createPayloadProcessor({ statusHandler: async () => ({ outcome: 'ignored' }) });
  const summary = await processor(batch({ statuses: [status] }));
  assert.equal(summary.statusesIgnored, 1); assert.equal(summary.applied, 0);
  assert.equal((await throughController(t, { statuses: [status] }, processor)).httpStatus, 200);
});
test('known and unknown statuses in a mixed signed batch preserve known effects and return 503', async t => {
  let calls = 0;
  const processor = webhook.createPayloadProcessor({ statusHandler: async () => { calls++; return { outcome: 'applied' }; }, observe: () => {} });
  const value = { statuses: [status, { ...status, status: 'future-status' }] };
  const result = await throughController(t, value, processor);
  assert.equal(result.httpStatus, 503); assert.equal(calls, 1);
  assert.equal(result.logs[0].data.applied, 1); assert.equal(result.logs[0].data.unsupported, 1);
});
test('invalid later event rejects the entire batch before handlers', async t => {
  let calls = 0;
  const result = await throughController(t, { statuses: [status, { status: 'delivered' }] }, async () => { calls++; });
  assert.equal(result.httpStatus, 400); assert.equal(calls, 0);
});
test('invalid signature cannot reach a handler even for a mixed batch', async t => {
  let calls = 0;
  const result = await throughController(t, { statuses: [status], errors: [{ code: 123 }] }, async () => { calls++; }, false);
  assert.equal(result.httpStatus, 401); assert.equal(calls, 0);
});
test('wrong WABA or Phone Number ID is rejected before processing', async () => {
  let calls = 0; const receiver = webhook.createWebhookReceiver({ configProvider: () => config, processor: async () => { calls++; } });
  for (const mismatch of ['waba', 'phone']) {
    const p = batch({ statuses: [status] });
    if (mismatch === 'waba') p.entry[0].id = '9999'; else p.entry[0].changes[0].value.metadata.phone_number_id = '9999';
    const raw = Buffer.from(JSON.stringify(p)), signature = 'sha256=' + crypto.createHmac('sha256', config.appSecret).update(raw).digest('hex');
    await assert.rejects(receiver(raw, signature), { code: 'WHATSAPP_ACCOUNT_MISMATCH' });
  }
  assert.equal(calls, 0);
});
test('provider errors expose only numeric codes; sensitive strings and message fields are discarded from logs', async t => {
  const logs = [];
  const processor = webhook.createPayloadProcessor({ observe: (action, data) => logs.push({ action, data }) });
  const value = { errors: [{ code: 123, title: 'PRIVATE', message: 'PRIVATE', error_data: { details: 'PRIVATE' } },
    { code: 'PRIVATE', message: 'PRIVATE' }] };
  const summary = await processor(batch(value));
  assert.equal(summary.providerErrors, 2); assert.equal(summary.received, 2); assert.equal(summary.applied, 0);
  assert.deepEqual(logs.map(l => l.data.providerCode), ['123', 'UNSPECIFIED']); assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  assert.equal((await throughController(t, value, processor)).httpStatus, 200);
});
test('unknown inbound type is reported unsupported without entering conversation engine', async t => {
  let calls = 0;
  const processor = webhook.createPayloadProcessor({ inboundHandler: async () => { calls++; }, observe: () => {} });
  const result = await throughController(t, { messages: [{ id: 'wamid.unknown', from: '15555550123', type: 'future-type' }] }, processor);
  assert.equal(result.httpStatus, 503); assert.equal(calls, 0);
});
test('direct processor reports invalid status instead of applying it', async () => {
  let calls = 0;
  const processor = webhook.createPayloadProcessor({ statusHandler: async () => { calls++; }, observe: () => {} });
  const summary = await processor(batch({ statuses: [{ status: 'read' }] }));
  assert.equal(summary.invalid, 1); assert.equal(summary.applied, 0); assert.equal(calls, 0);
});
for (const method of ['sendTextMessage', 'sendTemplateMessage']) {
  const data = method === 'sendTextMessage' ? text : { phoneNumber: text.phoneNumber, templateName: 'synthetic_template', templateLanguage: 'fr' };
  test(`${method}: oversized/malformed correlation is rejected before fake or network transport`, async () => {
    let calls = 0;
    for (const key of ['a'.repeat(513), 'é'.repeat(257), '', 123]) await assert.rejects(cloud[method]({ ...data, idempotencyKey: key }, {
      config, fetchImpl: async () => { calls++; },
    }), error => error.code === 'INVALID_CORRELATION_KEY' && error.uncertain === false);
    assert.equal(calls, 0);
  });
  test(`${method}: boundary correlation is sent unchanged`, async () => {
    const key = 'a'.repeat(512); let wire;
    await cloud[method]({ ...data, idempotencyKey: key }, { config, fetchImpl: async (url, options) => {
      wire = JSON.parse(options.body); assert.equal(options.redirect, 'error'); return response(200, { messages: [{ id: status.id }] });
    } });
    assert.equal(wire.biz_opaque_callback_data, key);
  });
  test(`${method}: disabled channel blocks direct calls even with fakeMode`, async () => {
    let calls = 0;
    for (const fakeMode of [false, true]) await assert.rejects(cloud[method](data, { config: { ...config, enabled: false, fakeMode },
      fetchImpl: async () => { calls++; } }), { code: 'WHATSAPP_DISABLED' });
    assert.equal(calls, 0);
  });
}
for (const [httpStatus, metaCode, category, retryable, uncertain] of [
  [400, 100, 'request_rejected', false, false], [401, 190, 'authentication', false, false],
  [403, 200, 'permission', false, false], [429, 130429, 'rate_limit', true, false],
  [408, 408, 'uncertain', false, true], [500, 1, 'uncertain', false, true], [503, 2, 'uncertain', false, true],
]) test(`HTTP ${httpStatus}: bounded Meta code and conservative classification, one request`, async () => {
  let calls = 0;
  await assert.rejects(cloud.sendTextMessage(text, { config, fetchImpl: async () => {
    calls++; return response(httpStatus, { error: { code: metaCode, message: 'PRIVATE', is_transient: true } });
  } }), error => error.code === String(metaCode) && error.category === category && error.retryable === retryable
    && error.uncertain === uncertain && !error.message.includes('PRIVATE'));
  assert.equal(calls, 1);
});
test('malformed rate-limit body and contradictory acceptance are uncertain, never automatically retried', async () => {
  for (const body of [{}, { error: {} }, { error: { code: 130429 }, messages: [{ id: status.id }] }]) {
    let calls = 0;
    await assert.rejects(cloud.sendTextMessage(text, { config, fetchImpl: async () => { calls++; return response(429, body); } }),
      e => e.uncertain === true && e.retryable === false);
    assert.equal(calls, 1);
  }
});
for (const stage of ['fetch', 'body']) test(`timeout while awaiting ${stage} is uncertain even if mock ignores AbortSignal`, async () => {
  let calls = 0, signal;
  await assert.rejects(cloud.sendTextMessage(text, { config, timeoutMs: 5, fetchImpl: async (url, options) => {
    calls++; signal = options.signal;
    if (stage === 'fetch') return new Promise(() => {});
    return { ok: true, status: 200, json: () => new Promise(() => {}) };
  } }), e => e.uncertain === true && e.retryable === false);
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('network exceptions never expose tokens or arbitrary provider data', async () => {
  await assert.rejects(cloud.sendTextMessage(text, { config, fetchImpl: async () => { throw new Error('PRIVATE'); } }),
    e => e.code === 'DELIVERY_UNCERTAIN' && !JSON.stringify(e).includes('PRIVATE') && !e.message.includes('PRIVATE'));
});
test('untrusted transport exception flags do not prove rejection or allow a retry', async () => {
  await assert.rejects(cloud.sendTextMessage(text, { config, fetchImpl: async () => {
    throw Object.assign(new Error('PRIVATE'), { code: 'PRIVATE', retryable: true, uncertain: false, acceptanceRejected: true });
  } }), e => e.code === 'DELIVERY_UNCERTAIN' && e.uncertain === true && e.retryable === false && !e.message.includes('PRIVATE'));
});
test('early then late duplicated callbacks preserve READ with a single send', async () => {
  const row = { id: 1, status: 'PROCESSING', providerMessageId: null, attempts: 1, deduplicationKey: 'operation', failureCode: null };
  const model = { findUnique: async ({ where }) => where.providerMessageId === row.providerMessageId || where.deduplicationKey === row.deduplicationKey ? { ...row } : null,
    updateMany: async ({ data }) => { Object.assign(row, data); return { count: 1 }; } };
  const callback = next => applyDeliveryStatus({ model, item: { ...status, status: next, biz_opaque_callback_data: 'operation' }, detailed: true });
  let sends = 0;
  await cloud.sendTextMessage({ ...text, idempotencyKey: 'operation' }, { config, fetchImpl: async () => {
    sends++; assert.equal((await callback('read')).outcome, 'applied'); return response(200, { messages: [{ id: status.id }] });
  } });
  for (const s of ['sent', 'delivered', 'read', 'failed']) assert.equal((await callback(s)).outcome, 'ignored');
  assert.equal(row.status, 'READ'); assert.equal(sends, 1); assert.equal(row.attempts, 1);
});
test('worker enablement defaults false and cannot start in test, regardless of activation flags', async () => {
  assert.equal(getWhatsAppConfig({ WHATSAPP_ENABLED: 'true' }).workersEnabled, false);
  for (const flags of [{ enabled: false, workersEnabled: true }, { enabled: true, workersEnabled: false }, { enabled: true, workersEnabled: true }]) {
    let loads = 0, timers = 0;
    const poller = createWhatsAppDeliveryPoller({ configProvider: () => flags, environment: () => 'test',
      loadProcessors: () => { loads++; throw new Error('No processors allowed'); }, schedule: () => { timers++; } });
    assert.equal(poller.start(), false); assert.deepEqual(await poller.runOnce(), []); assert.equal(loads, 0); assert.equal(timers, 0);
  }
});
test('missing worker opt-in blocks startup outside test too', async () => {
  let loads = 0;
  const poller = createWhatsAppDeliveryPoller({ configProvider: () => ({ enabled: true }), environment: () => 'development', loadProcessors: () => { loads++; } });
  assert.equal(poller.start(), false); assert.deepEqual(await poller.runOnce(), []); assert.equal(loads, 0);
});
test('explicit mock worker retains local concurrency guard and rechecks activation between circuits', async () => {
  let enabled = true, calls = 0, release;
  const poller = createWhatsAppDeliveryPoller({ environment: () => 'development', configProvider: () => ({ enabled, workersEnabled: true }),
    loadProcessors: () => [{ processPending: async () => { calls++; await new Promise(r => { release = r; }); enabled = false; return ['done']; } },
      { processPending: async () => { calls++; return []; } }] });
  const first = poller.runOnce(); assert.deepEqual(await poller.runOnce(), []); release();
  assert.deepEqual(await first, ['done']); assert.equal(calls, 1);
});
test('imported CLI and direct CLI run cannot start workers in test', async () => {
  const cli = require('../src/jobs/processWhatsAppDeliveries');
  assert.deepEqual(await cli.run(), []);
});
test('poller opt-in schedules one timer and stop cancels it without changing a queue', async () => {
  let schedules = 0, cancels = 0, ticks;
  const handle = { unref() {} };
  const poller = createWhatsAppDeliveryPoller({ environment: () => 'development', configProvider: () => ({ enabled: true, workersEnabled: true }),
    loadProcessors: () => [], schedule: fn => { schedules++; ticks = fn; return handle; }, cancel: timer => { assert.equal(timer, handle); cancels++; } });
  assert.equal(poller.start(), true); assert.equal(poller.start(), false); assert.equal(schedules, 1);
  await Promise.resolve(); poller.stop(); assert.equal(cancels, 1); assert.equal(typeof ticks, 'function');
});
test('isolation preload rejects default Prisma methods, real client construction and global fetch', async () => {
  const prisma = require('../src/utils/prisma');
  assert.throws(() => prisma.user.findMany(), /ISOLATED_TEST_DATABASE_ACCESS_FORBIDDEN/);
  const { PrismaClient } = require('@prisma/client');
  assert.throws(() => new PrismaClient(), /ISOLATED_TEST_DATABASE_ACCESS_FORBIDDEN/);
  await assert.rejects(global.fetch('https://example.invalid'), /ISOLATED_TEST_EXTERNAL_FETCH_FORBIDDEN/);
});
