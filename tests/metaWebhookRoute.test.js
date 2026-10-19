const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createHmac } = require('node:crypto');
const { createMetaWebhookRouter } = require('../src/routes/whatsappWebhookRoutes');
const { createMetaInboxRuntime } = require('../src/services/metaInboxRuntime');
const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxDispatcher } = require('../src/services/metaInboxDispatcher');
const { createMetaInboxPrismaAdapter } = require('../src/services/metaInboxPrismaAdapter');
const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
const endpointId = '33333333-3333-4333-8333-333333333333';
const scope = { endpointId, environment: 'test', applicationKey: 'synthetic-http', metaAppId: '3001', wabaId: '2001', phoneNumberId: '1001' };
const secret = 'synthetic-http-secret', env = { META_WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_VERIFY_TOKEN: 'synthetic-verify' };
function setup() {
  const mock = createMetaInboxMock({ id: endpointId, ...scope, inboxEnabled: true, processingEnabled: true, disabledAt: null,
    normalizationVersion: 1, identityVersion: 1, lookupKeyVersion: 'l1', streamKeyVersion: 's1' });
  const crypto = createMetaInboxCrypto({ lookupKeys: { l1: Buffer.alloc(32, 1) }, currentLookupVersion: 'l1',
    streamKey: Buffer.alloc(32, 2), streamKeyVersion: 's1', encryptionKeys: { e1: Buffer.alloc(32, 3) }, currentEncryptionVersion: 'e1' });
  const compose = () => {
    const repo = createMetaInboxRepository({ database: mock.db, scope, crypto });
    const service = createMetaInboxService({ repository: repo, scope, authentication: { secret, version: 'a1' }, mode: 'isolated' });
    return { repo, service };
  };
  const followUps = createWhatsAppProspectFollowUpService({ client: mock.db, configProvider: () => ({}) });
  const conversationService = createWhatsAppConversationService({ client: mock.db, followUps, followUpConfig: () => ({}),
    catalog: { listPublished: async () => [] }, registration: { listCoursesForPublicRegistration: async () => [] } });
  const dispatch = createMetaInboxDispatcher({ inboundTransaction: createMetaInboxPrismaAdapter({ endpointId, conversationService }) });
  return { ...mock, ...compose(), compose, dispatch };
}
function payload(value) { return { object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{ field: 'messages',
  value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, ...value } }] }] }; }
const stop = () => payload({ messages: [{ id: 'wamid.http.stop', from: '15555550123', type: 'text', text: { body: 'STOP' } }] });
async function server(t, options) {
  const app = express();
  if (options.parseFirst) {
    app.use(express.json({ verify: (req, res, bytes) => { req.rawBody = Buffer.from(bytes); } }));
    app.use((req, res, next) => { req.body = { replaced: true }; next(); });
  }
  app.use('/webhooks/whatsapp', createMetaWebhookRouter(options));
  const host = app.listen(0, '127.0.0.1'); await new Promise((resolve, reject) => { host.once('listening', resolve); host.once('error', reject); });
  t.after(() => new Promise(resolve => host.close(resolve)));
  return (method, path = '', value, headers = {}) => new Promise((resolve, reject) => {
    const body = value === undefined ? '' : JSON.stringify(value);
    const req = http.request({ hostname: '127.0.0.1', port: host.address().port, path: '/webhooks/whatsapp/' + path,
      method, agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
        'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'), ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.end(body);
  });
}
test('route is disabled by default for GET and POST without invoking ingress', async t => {
  const request = await server(t, { env: {}, inboxService: { acceptRaw: () => assert.fail('disabled') } });
  assert.equal((await request('GET')).status, 503); assert.equal((await request('POST', '', stop())).status, 503);
});
test('GET verifies exact token and returns the Meta challenge', async t => {
  const request = await server(t, { env, inboxService: setup().service });
  assert.deepEqual(await request('GET', '?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345'), { status: 200, text: '12345' });
  assert.equal((await request('GET', '?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345')).status, 403);
});
test('valid POST persists before ACK, duplicate remains a single event', async t => {
  const s = setup(), request = await server(t, { env, inboxService: s.service, now: s.time });
  assert.equal((await request('POST', '', stop())).status, 200); assert.equal(s.rows('metaWebhookEvent').length, 1);
  assert.equal((await request('POST', '', stop())).status, 200); assert.equal(s.rows('metaWebhookEvent').length, 1);
  assert.equal(s.rows('metaWebhookReceipt').length, 2);
});
test('mounted route authenticates original bytes after the application JSON parser', async t => {
  const s = setup(), request = await server(t, { env, inboxService: s.service, now: s.time, parseFirst: true });
  assert.equal((await request('POST', '', stop())).status, 200);
  assert.equal(s.rows('metaWebhookEvent').length, 1);
});
test('invalid signature, verify-token-only POST and wrong account never persist', async t => {
  const s = setup(), request = await server(t, { env, inboxService: s.service, now: s.time });
  assert.equal((await request('POST', '', stop(), { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) })).status, 403);
  assert.equal((await request('POST', '?hub.verify_token=synthetic-verify', stop(), { 'X-Hub-Signature-256': '' })).status, 403);
  const wrong = stop(); wrong.entry[0].id = '9999'; assert.equal((await request('POST', '', wrong)).status, 403);
  assert.equal(s.rows('metaWebhookReceipt').length, 0);
});
test('ACK cannot finish while durable acceptance is still pending', async t => {
  let entered, release, finished = false;
  const gate = new Promise(resolve => { entered = resolve; });
  const request = await server(t, { env, inboxService: { acceptRaw: () => { entered(); return new Promise(resolve => { release = resolve; }); } } });
  const response = request('POST', '', stop()).then(value => { finished = true; return value; });
  await gate; assert.equal(finished, false); release({ accepted: true }); assert.equal((await response).status, 200);
});
test('persistence errors return retryable HTTP failure without private details', async t => {
  const request = await server(t, { env, inboxService: { acceptRaw: async () => { throw new Error('private database diagnostic'); } } });
  const response = await request('POST', '', stop()); assert.equal(response.status, 503); assert.ok(!response.text.includes('private'));
});
test('STOP is durable before ACK, then explicit processing applies the real engine', async t => {
  const s = setup(), request = await server(t, { env, inboxService: s.service, now: s.time });
  assert.equal((await request('POST', '', stop())).status, 200);
  assert.equal((await s.repo.inspectBarrier('15555550123')).blocked, true);
  assert.equal(s.rows('whatsAppConversation').length, 0); // HTTP does not run a worker.
  const lease = await s.repo.claim({ owner: 'manual-local-test' });
  assert.equal((await s.repo.process(lease, s.dispatch)).state, 'PROCESSED');
  assert.equal(s.rows('whatsAppConversation')[0].controlState, 'OPTED_OUT');
});
test('unrelated callback remains durable across recomposition and processing', async t => {
  const s = setup(), request = await server(t, { env, inboxService: s.service, now: s.time });
  assert.equal((await request('POST', '', payload({ statuses: [{ id: 'wamid.unknown', status: 'delivered' }] }))).status, 200);
  const restarted = s.compose(), lease = await restarted.repo.claim({ owner: 'replacement-local-test' });
  assert.equal((await restarted.repo.process(lease, s.dispatch)).state, 'UNCORRELATED');
  assert.equal(s.rows('metaWebhookEvent').length, 1);
});
test('compressed and non-JSON requests are rejected locally', async t => {
  const request = await server(t, { env, inboxService: setup().service });
  assert.equal((await request('POST', '', stop(), { 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await request('POST', '', stop(), { 'Content-Type': 'text/plain' })).status, 415);
});
test('runtime refuses disabled, production, wrong role and forbidden port before constructing a client', () => {
  assert.throws(() => createMetaInboxRuntime({}), { code: 'META_INBOX_NOT_ACTIVATED' });
  assert.throws(() => createMetaInboxRuntime({ ...env, META_INBOX_ENVIRONMENT: 'test', NODE_ENV: 'production' }), { code: 'META_INBOX_NOT_ACTIVATED' });
  for (const target of ['postgresql://synthetic:unused@127.0.0.1:55432/nva_whatsapp_test',
    'postgresql://nva_meta_inbox_ingress:unused@127.0.0.1:5432/nva_whatsapp_test']) {
    assert.throws(() => createMetaInboxRuntime({ ...env, META_INBOX_ENVIRONMENT: 'test', META_INBOX_DATABASE_URL: target }), { code: 'META_INBOX_INVALID_CONFIGURATION' });
  }
});

test('production GET is closed until production mode, explicit authorization and target are valid', async t => {
  const production = { ...env, NODE_ENV: 'production', META_INBOX_ENVIRONMENT: 'production',
    META_INBOX_PRODUCTION_AUTHORIZED: 'true', WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false',
    META_INBOX_DATABASE_URL: 'postgresql://nva_meta_inbox_ingress_prod:synthetic-unused@127.0.0.1:5432/english_center' };
  for (const [changes, expected] of [[{ META_INBOX_PRODUCTION_AUTHORIZED: 'false' }, 503],
    [{ META_INBOX_ENVIRONMENT: 'test' }, 503], [{ META_INBOX_DATABASE_URL: undefined }, 503],
    [{ WHATSAPP_WORKERS_ENABLED: 'true' }, 503], [{}, 200]]) {
    const request = await server(t, { env: { ...production, ...changes }, inboxService: setup().service });
    assert.equal((await request('GET', '?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=12345')).status, expected);
  }
});
