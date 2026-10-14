const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { getWhatsAppConfig } = require('../src/config/whatsappConfig');
const { validateEnvironment } = require('../src/config/environment');
const webhook = require('../src/services/whatsappWebhookService');
const conversations = require('../src/services/whatsappConversationService');
const deliveries = require('../src/services/whatsappConversationDeliveryService');
const routes = require('../src/routes/whatsappWebhookRoutes');

const validEnv = {
  WHATSAPP_ENABLED: 'true', WHATSAPP_FAKE_MODE: 'false',
  WHATSAPP_PHONE_NUMBER_ID: '1001', WHATSAPP_BUSINESS_ACCOUNT_ID: '2001',
  WHATSAPP_ACCESS_TOKEN: 'isolated-test-token', WHATSAPP_VERIFY_TOKEN: 'isolated-verify',
  WHATSAPP_APP_SECRET: 'isolated-signing-secret', NODE_ENV: 'test',
};
function payload() {
  return { object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{
    field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' },
      messages: [{ id: 'wamid.test', from: '243812345678', timestamp: '1791547200', type: 'text', text: { body: 'Bonjour' } }],
    },
  }] }] };
}
function sign(raw, secret = validEnv.WHATSAPP_APP_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}
async function harness(t, overrides = {}) {
  const old = { ...process.env };
  Object.assign(process.env, validEnv, overrides);
  for (const [key, value] of Object.entries(overrides)) if (value === undefined) delete process.env[key];
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
  });
  // These are the persistence boundaries. No real Prisma method is invoked.
  const inbound = t.mock.method(conversations, 'processInboundMessage', async () => ({ ignored: false, duplicate: false, queuedResponses: 1 }));
  const statuses = t.mock.method(deliveries, 'applyStatus', async () => true);
  const app = express();
  app.use('/webhooks/whatsapp', (req, res, next) => {
    const encoding = req.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') return res.sendStatus(415);
    return next();
  });
  app.use(express.json({ limit: '1mb', inflate: false, verify: (req, res, raw) => { req.rawBody = Buffer.from(raw); } }));
  // Deliberately different parsed body: the receiver must use authenticated bytes.
  app.use((req, res, next) => { req.body = { untrustedReplacement: true }; next(); });
  app.use('/webhooks/whatsapp', routes);
  app.use((error, req, res, next) => res.sendStatus(400));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(raw, signature, method = 'POST', suffix = '', extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port,
        path: '/webhooks/whatsapp' + suffix, method,
        headers: { 'Content-Type': 'application/json', ...(signature === undefined ? {} : { 'x-hub-signature-256': signature }), ...extraHeaders },
      }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(raw);
    });
  }
  function noPersistence() {
    assert.equal(inbound.mock.callCount(), 0, 'no conversation/message persistence');
    assert.equal(statuses.mock.callCount(), 0, 'no delivery status persistence');
  }
  return { request, inbound, statuses, noPersistence };
}

test('disabled POST is refused even with a correct signature', async t => {
  const h = await harness(t, { WHATSAPP_ENABLED: 'false' });
  const raw = Buffer.from(JSON.stringify(payload()));
  assert.equal(await h.request(raw, sign(raw)), 403); h.noPersistence();
});
for (const [name, secret] of [['absent', undefined], ['empty', ''], ['whitespace', '   ']]) {
  test(`${name} secret refuses empty-key signatures without persistence`, async t => {
    const h = await harness(t, { WHATSAPP_APP_SECRET: secret });
    const raw = Buffer.from(JSON.stringify(payload()));
    assert.equal(webhook.verifySignature(raw, sign(raw, '')), false);
    assert.equal(await h.request(raw, sign(raw, '')), 401); h.noPersistence();
  });
}
for (const [name, signature] of [['absent', undefined], ['incorrect', 'sha256=' + '0'.repeat(64)], ['malformed', 'sha256=00'], ['trailing junk', 'sha256=' + '0'.repeat(64) + 'junk']]) {
  test(`${name} signature is refused without persistence`, async t => {
    const h = await harness(t); const raw = Buffer.from(JSON.stringify(payload()));
    assert.equal(await h.request(raw, signature), 401); h.noPersistence();
  });
}
test('correct signature accepts exact raw bytes and invokes the inbound handler once', async t => {
  const h = await harness(t); const event = payload(); const raw = Buffer.from(JSON.stringify(event, null, 2));
  assert.equal(await h.request(raw, sign(raw)), 200);
  assert.equal(h.inbound.mock.callCount(), 1);
  assert.deepEqual(h.inbound.mock.calls[0].arguments[0], event.entry[0].changes[0].value.messages[0]);
});
test('changing raw whitespace invalidates a signature', async t => {
  const h = await harness(t); const raw = Buffer.from(JSON.stringify(payload()));
  assert.equal(await h.request(Buffer.concat([raw, Buffer.from(' ')]), sign(raw)), 401); h.noPersistence();
});
test('invalid JSON is refused before persistence', async t => {
  const h = await harness(t); const raw = Buffer.from('{invalid');
  assert.equal(await h.request(raw, sign(raw)), 400); h.noPersistence();
});
test('missing raw buffer cannot pass signature verification', () => {
  const raw = Buffer.from(JSON.stringify(payload()));
  assert.equal(webhook.verifySignature(undefined, sign(raw), getWhatsAppConfig(validEnv)), false);
  assert.equal(webhook.verifySignature(raw.toString(), sign(raw), getWhatsAppConfig(validEnv)), false);
});
test('compressed body is refused without persistence', async t => {
  const h = await harness(t); const raw = require('node:zlib').gzipSync(Buffer.from(JSON.stringify(payload())));
  assert.equal(await h.request(raw, sign(raw), 'POST', '', { 'Content-Encoding': 'gzip' }), 415); h.noPersistence();
});
const malformed = [
  ['wrong object', p => { p.object = 'other'; }],
  ['invalid entry array', p => { p.entry = {}; }],
  ['wrong field', p => { p.entry[0].changes[0].field = 'other'; }],
  ['missing metadata', p => { delete p.entry[0].changes[0].value.metadata; }],
  ['invalid messages', p => { p.entry[0].changes[0].value.messages = {}; }],
  ['missing text', p => { delete p.entry[0].changes[0].value.messages[0].text; }],
  ['invalid timestamp', p => { p.entry[0].changes[0].value.messages[0].timestamp = '999999999999999999999'; }],
];
for (const [name, mutate] of malformed) {
  test(`malformed event (${name}) is refused without persistence`, async t => {
    const h = await harness(t); const event = payload(); mutate(event); const raw = Buffer.from(JSON.stringify(event));
    assert.equal(await h.request(raw, sign(raw)), 400); h.noPersistence();
  });
}
for (const kind of ['business', 'phone']) {
  test(`different ${kind} account is refused without persistence`, async t => {
    const h = await harness(t); const event = payload();
    if (kind === 'business') event.entry[0].id = '9999';
    else event.entry[0].changes[0].value.metadata.phone_number_id = '9999';
    const raw = Buffer.from(JSON.stringify(event));
    assert.equal(await h.request(raw, sign(raw)), 403); h.noPersistence();
  });
}
test('invalid later entry rejects the entire batch before the valid first entry writes', async t => {
  const h = await harness(t); const event = payload(); const second = payload().entry[0]; second.id = '9999'; event.entry.push(second);
  const raw = Buffer.from(JSON.stringify(event));
  assert.equal(await h.request(raw, sign(raw)), 403); h.noPersistence();
});
test('authenticated delivery statuses remain supported', async t => {
  const h = await harness(t); const event = payload(); const value = event.entry[0].changes[0].value;
  delete value.messages; value.statuses = [{ id: 'wamid.out', status: 'delivered', timestamp: '1791547200' }];
  const raw = Buffer.from(JSON.stringify(event)); assert.equal(await h.request(raw, sign(raw)), 200);
  assert.equal(h.statuses.mock.callCount(), 1); assert.equal(h.inbound.mock.callCount(), 0);
});
test('incomplete enabled configuration refuses a signed request without persistence', async t => {
  const h = await harness(t, { WHATSAPP_BUSINESS_ACCOUNT_ID: '' }); const raw = Buffer.from(JSON.stringify(payload()));
  assert.equal(await h.request(raw, sign(raw)), 503); h.noPersistence();
});
test('disabled GET verification cannot subscribe the webhook', async t => {
  const h = await harness(t, { WHATSAPP_ENABLED: 'false' });
  assert.equal(await h.request(undefined, undefined, 'GET', '?hub.mode=subscribe&hub.verify_token=isolated-verify&hub.challenge=123'), 403);
  h.noPersistence();
});
test('enabled GET verification preserves the Meta challenge', async t => {
  const h = await harness(t);
  assert.equal(await h.request(undefined, undefined, 'GET', '?hub.mode=subscribe&hub.verify_token=isolated-verify&hub.challenge=123'), 200);
  h.noPersistence();
});
test('startup validation rejects each missing enabled parameter and permits disabled configuration', () => {
  const base = { ...validEnv, DATABASE_URL: 'postgresql://test:test@localhost/unused', PORT: '0' };
  for (const key of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_BUSINESS_ACCOUNT_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET']) {
    assert.throws(() => validateEnvironment({ ...base, [key]: '' }), /Configuration WhatsApp incomplète/);
  }
  assert.doesNotThrow(() => validateEnvironment({ DATABASE_URL: base.DATABASE_URL, WHATSAPP_ENABLED: 'false', PORT: '0' }));
  assert.doesNotThrow(() => validateEnvironment(base));
  assert.throws(() => getWhatsAppConfig({ ...validEnv, NODE_ENV: 'production', WHATSAPP_FAKE_MODE: 'true' }, { requireValid: true }), /interdit/);
  assert.throws(() => getWhatsAppConfig({ ...validEnv, WHATSAPP_PHONE_NUMBER_ID: 'invalid' }, { requireValid: true }), /Identifiants/);
});
