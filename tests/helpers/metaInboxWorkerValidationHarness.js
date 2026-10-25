// Isolated contracts + actual engine/repository/delivery composition. No DB/Meta.
const test = require('node:test'), assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { createMetaInboxMock } = require('./metaInboxMock');
const { readMetaInboxWorkerConfig } = require('../../src/config/metaInboxWorkerConfig');
const { createMetaInboxWorker } = require('../../src/services/metaInboxWorkerService');
const { createMetaInboxRepository } = require('../../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../../src/services/metaInboxService');
const cloud = require('../../src/services/whatsappCloudApiService');
const endpointId = '77777777-7777-4777-8777-777777777777';
function environment() { return {
  NODE_ENV: 'test', META_INBOX_ENVIRONMENT: 'test', META_WHATSAPP_INBOX_ENABLED: 'true', META_INBOX_WORKER_ENABLED: 'true',
  META_INBOX_DATABASE_URL: 'postgresql://nva_meta_inbox_ingress:synthetic@127.0.0.1:55432/nva_whatsapp_test',
  META_INBOX_WORKER_DATABASE_URL: 'postgresql://nva_meta_inbox_worker:synthetic@127.0.0.1:55432/nva_whatsapp_test',
  WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false', WHATSAPP_ACCESS_TOKEN: 'synthetic-no-real-token',
  WHATSAPP_PHONE_NUMBER_ID: '1001', WHATSAPP_BUSINESS_ACCOUNT_ID: '2001', WHATSAPP_GRAPH_API_VERSION: 'v23.0',
  META_INBOX_ENDPOINT_ID: endpointId, META_INBOX_APPLICATION_KEY: 'worker-test', META_INBOX_APP_ID: '3001',
  META_INBOX_LOOKUP_KEYS_JSON: JSON.stringify({ l1: '01'.repeat(32) }), META_INBOX_LOOKUP_KEY_VERSION: 'l1',
  META_INBOX_STREAM_KEY_HEX: '02'.repeat(32), META_INBOX_STREAM_KEY_VERSION: 's1',
  META_INBOX_ENCRYPTION_KEYS_JSON: JSON.stringify({ e1: '03'.repeat(32) }), META_INBOX_ENCRYPTION_KEY_VERSION: 'e1',
  META_INBOX_SEND_ENABLED: 'true', META_INBOX_SEND_NOT_BEFORE: '2026-10-16T00:00:00Z',
}; }
function setup(changes = {}) {
  const env = { ...environment(), ...changes }, cfg = readMetaInboxWorkerConfig(env);
  const s = createMetaInboxMock({ id: endpointId, ...cfg.scope, inboxEnabled: true, processingEnabled: true, disabledAt: null,
    identityVersion: 1, normalizationVersion: 1, lookupKeyVersion: 'l1', streamKeyVersion: 's1' }, { allowReadCommitted: true });
  const baseQuery = s.db.$queryRaw;
  let badIdentity = false;
  s.db.$queryRaw = async (strings, ...values) => {
    const sql = strings.join('');
    if (sql.includes('current_database()')) return [{ database: 'nva_whatsapp_test', role: badIdentity ? 'postgres' : 'nva_meta_inbox_worker',
      address: '127.0.0.1', port: 55432, rolcanlogin: true, rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolreplication: false, rolbypassrls: false, rolinherit: false, memberships: false, database_create: false, schema_create: false, forbidden: false }];
    if (sql.includes('AS outgoing_id')) {
      const stale = sql.includes("delivery_status='PROCESSING'");
      const ids = s.rows('whatsAppConversationMessage').filter(m => {
        const event = s.rows('metaWebhookEvent').find(e => e.endpointId === values[0] && e.kind === 'INBOUND' && e.state === 'PROCESSED' && e.effectOutcome === 'APPLIED'
          && ['wa-reply:' + e.nativeMessageId + ':0', 'wa-handoff:' + e.nativeMessageId + ':0'].includes(m.idempotencyKey));
        return event && !m.senderUserId && m.direction === 'OUTBOUND' && m.deliveryStatus === (stale ? 'PROCESSING' : 'QUEUED')
          && (stale ? m.updatedAt < values[1] : event.firstReceivedAt >= values[1] && m.createdAt >= values[2] && m.updatedAt <= values[3] && m.attempts < values[4]);
      });
      return ids.slice(0, values.at(-1)).map(m => ({ outgoing_id: m.id }));
    }
    return baseQuery(strings, ...values);
  };
  const model = s.db.whatsAppConversationMessage, create = model.create, findUnique = model.findUnique;
  model.create = input => create({ ...input, data: { attempts: 0, senderUserId: null, failureCode: null, providerMessageId: null, textFallbackPending: false,
    updatedAt: s.time(), createdAt: s.time(), ...input.data } });
  model.findUnique = async args => { const row = await findUnique(args); if (row && args.include?.conversation) row.conversation = await s.db.whatsAppConversation.findUnique({ where: { id: row.conversationId } }); return row; };
  s.seed('whatsAppChatbotSettings', { id: 1, enabled: true, admissionsEnabled: true, aiEnabled: false });
  const course = { id: 1, title: 'Anglais pratique', slug: 'anglais-pratique', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16,
    accessPolicy: 'LEGACY_STAGED', price: 60, currency: 'USD', pricingActive: true, pricingMode: 'ONE_TIME' };
  const catalog = { listPublished: async () => [course] }, registration = { listCoursesForPublicRegistration: async () => [{ ...course, session: { weekDays: ['Friday', 'Saturday'], startTime: '10:00', endTime: '11:30' } }] };
  const repo = createMetaInboxRepository({ database: s.db, scope: cfg.scope, crypto: cfg.crypto });
  const inbox = createMetaInboxService({ repository: repo, scope: cfg.scope, authentication: { secret: 'synthetic', version: 'a1' }, mode: 'isolated' });
  const logs = [], sent = []; let rejectSend;
  const sender = (data, options) => cloud.sendConversationMessage(data, { ...options, fetchImpl: async (url, init) => {
    assert.match(url, /^https:\/\/graph.facebook.com\//); const body = JSON.parse(init.body); sent.push(body);
    if (rejectSend) { const fn = rejectSend; rejectSend = null; return fn(); }
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.sent.' + sent.length }] }) };
  } });
  const makeWorker = () => createMetaInboxWorker({ env, database: { ...s.db, $disconnect: async () => {} }, catalog, registration, sender, now: s.time,
    observe: (action, data) => logs.push({ action, ...data }) });
  let lastMessage;
  const receive = async (text, extra = {}) => {
    lastMessage = { id: 'wamid.in.' + randomUUID(), from: '243812345678', type: 'text', timestamp: String(+s.time() / 1000), text: { body: text }, ...extra };
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, messages: [lastMessage] } }] }] }));
    return inbox.acceptRaw({ rawBody, signature: 'sha256=' + createHmac('sha256', 'synthetic').update(rawBody).digest('hex'), receivedAt: s.time() });
  };
  return { ...s, env, cfg, repo, makeWorker, receive, sent, logs, catalog, registration, last: () => lastMessage,
    badIdentity: () => { badIdentity = true; }, rejectSend: fn => { rejectSend = fn; } };
}

module.exports={setup};
