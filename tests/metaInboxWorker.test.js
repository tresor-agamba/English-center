// Isolated contracts + actual engine/repository/delivery composition. No DB/Meta.
const test = require('node:test'), assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
const { readMetaInboxWorkerConfig } = require('../src/config/metaInboxWorkerConfig');
const { createMetaInboxWorker } = require('../src/services/metaInboxWorkerService');
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const cloud = require('../src/services/whatsappCloudApiService');
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
  const makeWorker = (extra = {}) => createMetaInboxWorker({ env, database: { ...s.db, $disconnect: async () => {} }, catalog, registration, sender, now: s.time, ...extra,
    observe: (action, data) => logs.push({ action, ...data }) });
  let lastMessage;
  const receive = async (text, extra = {}) => {
    lastMessage = { id: 'wamid.in.' + randomUUID(), from: '243812345678', type: 'text', timestamp: String(+s.time() / 1000), text: { body: text }, ...extra };
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, messages: [lastMessage] } }] }] }));
    return inbox.acceptRaw({ rawBody, signature: 'sha256=' + createHmac('sha256', 'synthetic').update(rawBody).digest('hex'), receivedAt: s.time() });
  };
  return { ...s, env, cfg, repo, makeWorker, receive, sent, logs, last: () => lastMessage,
    badIdentity: () => { badIdentity = true; }, rejectSend: fn => { rejectSend = fn; } };
}
test('Meta V3 persists explicit consent and sends one scoped template after 48h of inactivity', async () => {
  const s = setup({ NVA_AI_ENABLED: 'true', NVA_FOLLOWUPS_ENABLED: 'true', NVA_FOLLOWUPS_DRY_RUN: 'false' });
  const model = s.db.whatsAppProspectFollowUp, read = model.findUnique;
  model.findUnique = async args => { const r = await read(args); if (r && args.include?.conversation) r.conversation = await s.db.whatsAppConversation.findUnique({ where: { id: r.conversationId } }); return r; };
  let followupCalls = 0;
  const w = s.makeWorker({ followUpTemplateVerifier: async () => true, followUpSender: async data => {
    assert.equal(data.templateName, 'nva_followup_fr'); assert.deepEqual(data.templateParameters, []);
    followupCalls++; return { providerMessageId: 'wamid.v3.followup' };
  } });
  for (const text of ['menu', '3', 'Je veux apprendre anglais pratique', 'relances', 'OUI RELANCES']) { await s.receive(text); await w.runOnce(); }
  assert.equal(s.rows('whatsAppCommercialConsentEvent')[0].noticeVersion, 'lead-follow-up-48h-v3');
  const row = s.rows('whatsAppProspectFollowUp')[0]; assert.ok(row);
  // The contract mock does not implement PostgreSQL defaults.
  Object.assign(row, { status: 'PENDING', attempts: 0, providerMessageId: null, failureCode: null, updatedAt: s.time() });
  s.advance(48 * 3600000 - 1); await w.runOnce(); assert.equal(followupCalls, 0);
  await s.receive('merci', { timestamp: String(Math.floor(+s.time() / 1000)) }); await w.runOnce();
  s.advance(1); await w.runOnce(); assert.equal(followupCalls, 0);
  s.advance(48 * 3600000 - 1); await w.runOnce(); assert.equal(followupCalls, 1);
  await w.runOnce(); assert.equal(followupCalls, 1);
});

test('worker and CLI are disabled by default without constructing DB or transport', async () => {
  let calls = 0; assert.throws(() => createMetaInboxWorker({ env: {}, createDatabase: () => { calls++; } }), { code: 'META_WORKER_DISABLED' });
  assert.deepEqual(await require('../src/jobs/processMetaInbox').run({ env: {}, createWorker: () => { calls++; } }), { disabled: true }); assert.equal(calls, 0);
});

test('documented activation defaults remain disabled and legacy flags are normalized', () => {
  const sample = require('node:fs').readFileSync(require('node:path').join(__dirname,'../.env.example'),'utf8');
  for (const key of ['WHATSAPP_ENABLED','WHATSAPP_WORKERS_ENABLED','META_WHATSAPP_INBOX_ENABLED',
    'META_INBOX_PRODUCTION_AUTHORIZED','META_INBOX_WORKER_ENABLED','META_INBOX_WORKER_PRODUCTION_AUTHORIZED',
    'META_INBOX_SEND_ENABLED','META_INBOX_SEND_PRODUCTION_AUTHORIZED']) {
    assert.match(sample,new RegExp('^'+key+'=false\\r?$','m'));
  }
  for(const key of ['WHATSAPP_ENABLED','WHATSAPP_WORKERS_ENABLED']) {
    assert.throws(()=>readMetaInboxWorkerConfig({...environment(),[key]:' TRUE '}),{code:'META_WORKER_LEGACY_CONFLICT'});
  }
});
test('production requires separate processing and sending authorizations, dedicated role and cutoff', () => {
  const env = { ...environment(), NODE_ENV: 'production', META_INBOX_ENVIRONMENT: 'production', META_INBOX_PRODUCTION_AUTHORIZED: 'true',
    META_INBOX_DATABASE_URL: 'postgresql://nva_meta_inbox_ingress_prod:synthetic@127.0.0.1:5432/english_center',
    META_INBOX_WORKER_DATABASE_URL: 'postgresql://nva_meta_inbox_worker_prod:synthetic@127.0.0.1:5432/english_center' };
  assert.throws(() => readMetaInboxWorkerConfig(env), { code: 'META_WORKER_NOT_AUTHORIZED' }); env.META_INBOX_WORKER_PRODUCTION_AUTHORIZED = 'true';
  assert.throws(() => readMetaInboxWorkerConfig(env), { code: 'META_WORKER_SEND_NOT_AUTHORIZED' }); env.META_INBOX_SEND_PRODUCTION_AUTHORIZED = 'true';
  assert.equal(readMetaInboxWorkerConfig(env).sendEnabled, true);
  for (const patch of [{ WHATSAPP_ENABLED: 'true' }, { WHATSAPP_WORKERS_ENABLED: 'true' }, { META_INBOX_SEND_NOT_BEFORE: '' },
    { META_INBOX_WORKER_DATABASE_URL: env.META_INBOX_DATABASE_URL }, { META_INBOX_WORKER_DATABASE_URL: env.META_INBOX_WORKER_DATABASE_URL + '?host=remote' }]) assert.throws(() => readMetaInboxWorkerConfig({ ...env, ...patch }));
});
test('Bonjour persists menu then delivers an interactive Cloud API payload with a mocked transport', async () => {
  const s = setup(); await s.receive('Bonjour'); const w = s.makeWorker(); const r = await w.runOnce();
  assert.equal(r.processed, 1); assert.equal(r.accepted, 1); assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].type, 'interactive'); assert.match(s.sent[0].interactive.body.text, /100 % en ligne/);
  assert.equal(s.rows('metaWebhookEvent')[0].state, 'PROCESSED'); assert.equal(s.rows('whatsAppConversationMessage').find(m => m.direction === 'OUTBOUND').deliveryStatus, 'ACCEPTED');
});
for (const [input, pattern] of [['formations', /trois niveaux/], ['tarifs', /60 USD par niveau/], ['horaires', /vendredi et samedi/], ['inscription', /inscription/]]) {
  test('actual worker engine handles ' + input, async () => { const s = setup(); await s.receive(input); const r = await s.makeWorker().runOnce(); assert.equal(r.accepted, 1); assert.match(s.sent[0].interactive.body.text, pattern); });
}
test('processing-only mode commits reply but cannot send; later worker can deliver it', async () => {
  const s = setup({ META_INBOX_SEND_ENABLED: 'false' }); await s.receive('bonjour'); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 0);
  assert.equal(s.rows('whatsAppConversationMessage').find(m => m.direction === 'OUTBOUND').deliveryStatus, 'QUEUED');
  s.env.META_INBOX_SEND_ENABLED = 'true'; assert.equal((await s.makeWorker().runOnce()).accepted, 1);
});
test('processing_enabled=false prevents claims and sends; HTTP acceptance alone leaves READY', async () => {
  const s = setup(); s.rows('metaWebhookEndpoint')[0].processingEnabled = false; await s.receive('bonjour');
  await assert.rejects(s.makeWorker().runOnce(), { code: 'META_INBOX_PROCESSING_DISABLED' }); assert.equal(s.sent.length, 0); assert.equal(s.rows('metaWebhookEvent')[0].state, 'READY');
});
test('duplicate webhook and repeated poll never produce a second reply or send', async () => {
  const s = setup(); await s.receive('bonjour'); const message = s.last(); const w = s.makeWorker(); await w.runOnce();
  await s.receive('bonjour', { id: message.id }); await w.runOnce(); await s.makeWorker().runOnce();
  assert.equal(s.sent.length, 1); assert.equal(s.rows('whatsAppConversationMessage').filter(m => m.direction === 'OUTBOUND').length, 1);
});
test('expired incoming lease is recovered after worker restart', async () => {
  const s = setup(); await s.receive('bonjour'); await s.repo.claim({ owner: 'crashed-worker', leaseMs: 1000 }); s.advance(2000);
  assert.equal((await s.makeWorker().runOnce()).accepted, 1); assert.equal(s.rows('metaWebhookEvent')[0].leaseGeneration, 2n);
});
test('temporary PostgreSQL failure leaves batch safe and next poll processes it; logs omit private errors', async () => {
  const s = setup(); await s.receive('bonjour'); const w = s.makeWorker(); s.failBegin('P1001');
  await assert.rejects(w.runOnce()); assert.equal(s.sent.length, 0); await w.runOnce(); assert.equal(s.sent.length, 1);
  const log = JSON.stringify(s.logs); assert.doesNotMatch(log, /PRIVATE|243812345678|synthetic-no-real-token|postgresql:|Bonjour/);
});
test('worker refuses a privileged/wrong actual SQL identity', async () => { const s = setup(); await s.receive('bonjour'); s.badIdentity(); await assert.rejects(s.makeWorker().runOnce(), { code: 'META_WORKER_DATABASE_IDENTITY_REJECTED' }); assert.equal(s.sent.length, 0); });
test('STOP queued before send cancels all automatic replies and records opt-out', async () => {
  const s = setup({ META_INBOX_SEND_ENABLED: 'false' }); await s.receive('bonjour'); await s.makeWorker().runOnce(); await s.receive('STOP');
  s.env.META_INBOX_SEND_ENABLED = 'true'; await s.makeWorker().runOnce(); assert.equal(s.sent.length, 0);
  assert.equal(s.rows('whatsAppConversation')[0].controlState, 'OPTED_OUT'); assert.equal(s.rows('whatsAppCommercialConsentEvent')[0].decision, 'REVOKED');
});
test('human handoff sends only the acknowledgment; subsequent ordinary input stays paused', async () => {
  const s = setup(); await s.receive('conseiller'); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1);
  assert.equal(s.rows('whatsAppConversation')[0].controlState, 'HUMAN_TAKEOVER'); await s.receive('tarifs'); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1);
});
test('unprocessed STOP at submission barrier prevents a physical send', async () => {
  const s = setup(); await s.receive('bonjour'); const w = s.makeWorker(); const original = s.db.whatsAppConversationMessage.findMany;
  let intercepted = false; s.db.whatsAppConversationMessage.findMany = async args => { const rows = await original(args); if (args.where.id && !intercepted) { intercepted = true; await s.receive('STOP'); } return rows; };
  const w2 = s.makeWorker(); await w2.runOnce(); assert.equal(s.sent.length, 0);
});
test('ambiguous transport is never retried on restart', async () => {
  const s = setup(); await s.receive('bonjour'); s.rejectSend(() => { throw new Error('PRIVATE_TOKEN_URL'); }); await s.makeWorker().runOnce();
  assert.equal(s.rows('whatsAppConversationMessage').find(m => m.direction === 'OUTBOUND').failureCode, 'DELIVERY_UNCERTAIN');
  await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1);
});
test('definitive 429 is retried after its backoff without rerunning inbound effects', async () => {
  const s = setup(); await s.receive('bonjour'); s.rejectSend(() => ({ ok: false, status: 429, json: async () => ({ error: { code: 130429 } }) }));
  await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1);
  s.advance(60001); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 2); assert.equal(s.rows('whatsAppConversationMessage').filter(m => m.direction === 'INBOUND').length, 1);
});
test('engaged outgoing message abandoned at crash becomes uncertain, never resent', async () => {
  const s = setup({ META_INBOX_SEND_ENABLED: 'false' }); await s.receive('bonjour'); await s.makeWorker().runOnce();
  const row = s.rows('whatsAppConversationMessage').find(m => m.direction === 'OUTBOUND'); row.deliveryStatus = 'PROCESSING'; row.attempts = 1; row.failureCode = 'SUBMISSION_ENGAGED';
  s.advance(16 * 60000); s.env.META_INBOX_SEND_ENABLED = 'true'; await s.makeWorker().runOnce();
  assert.equal(s.sent.length, 0); assert.equal(s.rows('whatsAppConversationMessage').find(m => m.direction === 'OUTBOUND').failureCode, 'DELIVERY_UNCERTAIN');
});
test('cutoff does not flush a historical reply or unrelated queued messages', async () => {
  const s = setup({ META_INBOX_SEND_ENABLED: 'false' }); await s.receive('bonjour'); await s.makeWorker().runOnce();
  s.seed('whatsAppConversationMessage', { id: 'unrelated', direction: 'OUTBOUND', deliveryStatus: 'QUEUED', attempts: 0, idempotencyKey: 'wa-manual:1', createdAt: s.time(), updatedAt: s.time() });
  s.env.META_INBOX_SEND_NOT_BEFORE = '2026-10-17T00:00:00Z'; s.env.META_INBOX_SEND_ENABLED = 'true'; await s.makeWorker().runOnce(); assert.equal(s.sent.length, 0);
});
test('live send switch stops output and identity/key changes require a restart', async () => {
  const s = setup(); const w = s.makeWorker(); s.env.META_INBOX_ENDPOINT_ID = randomUUID(); await assert.rejects(w.runOnce(), { code: 'META_WORKER_CONFIGURATION_CHANGED' }); assert.equal(s.sent.length, 0);
});
test('a rolled-back engine failure retries later without a partial reply', async () => {
  const s = setup(); await s.receive('bonjour'); s.failCreate('whatsAppConversationMessage');
  assert.equal((await s.makeWorker().runOnce()).retrying, 1); assert.equal(s.sent.length, 0); assert.equal(s.rows('whatsAppConversation').length, 0);
  s.advance(2001); await s.makeWorker().runOnce(); assert.equal(s.sent.length, 1);
});
test('raw SQL serialization conflicts are retried, unrelated SQL errors are not', async () => {
  const s = setup(); await s.receive('bonjour'); const transaction = s.db.$transaction; let attempts = 0;
  s.db.$transaction = (...args) => { if (++attempts === 1) throw Object.assign(new Error('PRIVATE_SQL'), { code: 'P2010', meta: { code: '40001' } }); return transaction(...args); };
  assert.ok(await s.repo.claim({ owner: 'retry-test' })); assert.equal(attempts, 2);
  attempts = 0; s.db.$transaction = () => { attempts++; throw Object.assign(new Error('PRIVATE_SQL'), { code: 'P2010', meta: { code: '42501' } }); };
  await assert.rejects(s.repo.claim({ owner: 'permission-test' }), { code: 'META_INBOX_STORAGE_FAILED' }); assert.equal(attempts, 1);
});
test('worker delivers list and button clicks by stable IDs through the existing engine', async () => {
  const s = setup(); const w = s.makeWorker(); await s.receive('bonjour'); await w.runOnce();
  let conv = s.rows('whatsAppConversation')[0]; let option = conv.engineState.admission.options.find(o => o.id === 'registration');
  await s.receive('', { type: 'interactive', interactive: { list_reply: { id: option.wireId, title: 'Label changed' } } }); await w.runOnce();
  conv = s.rows('whatsAppConversation')[0]; option = conv.engineState.admission.options.find(o => o.id === 'admin');
  await s.receive('', { type: 'interactive', interactive: { button_reply: { id: option.wireId, title: 'Other label' } } }); await w.runOnce();
  assert.equal(s.sent.length, 3); assert.match(s.sent[2].interactive.body.text, /collecte temporaire/);
});
test('CLI polls again after a temporary batch failure and closes on its disable switch', async () => {
  const env = { META_INBOX_WORKER_ENABLED: 'true' }; let calls = 0, closed = 0;
  const result = await require('../src/jobs/processMetaInbox').run({ env, createWorker: () => ({ ready: async () => true, intervalMs: 1,
    runOnce: async () => { if (++calls === 1) throw Error('PRIVATE_DB_DETAILS'); env.META_INBOX_WORKER_ENABLED = 'false'; }, close: async () => { closed++; } }) });
  assert.equal(calls, 2); assert.equal(closed, 1); assert.deepEqual(result, { stopped: true });
});

test('STOP for an existing student works without selecting password hashes', async () => {
  const s = setup();
  s.seed('user', { id: 42, phoneNumber: '+243812345678', whatsappNumber: '+243812345678' });
  s.seed('whatsAppPreference', { id: 42, userId: 42, phoneNumber: '+243812345678', isEnabled: true, hasOptedIn: true });
  const find = s.db.user.findUnique;
  s.db.user.findUnique = async args => {
    assert.deepEqual(args.select, { phoneNumber: true, whatsappNumber: true, whatsappPreference: { select: { phoneNumber: true } } });
    return find(args);
  };
  await s.receive('STOP'); const result = await s.makeWorker().runOnce();
  assert.equal(result.processed, 1); assert.equal(s.sent.length, 0);
  assert.equal(s.rows('whatsAppPreference')[0].hasOptedIn, false);
  assert.equal(s.rows('whatsAppConversation')[0].controlState, 'OPTED_OUT');
});

test('Meta worker completes QUESTION_AI after commit and sends through the existing unique delivery path',async()=>{
 const s=setup({NVA_AI_ENABLED:'true',OPENAI_API_KEY:randomUUID(),OPENAI_MODEL:'mock-model'});
 const settings=s.rows('whatsAppChatbotSettings')[0];settings.admissionsEnabled=true;
 s.seed('course',{id:1,title:'Anglais général',slug:'anglais-general',shortDescription:'Cours en ligne',durationValue:8,durationUnit:'WEEK',structureType:'LEVEL_BASED',numberOfLevels:3,sessionCount:16,accessPolicy:'LEGACY_STAGED',price:60,currency:'USD',pricingMode:'ONE_TIME',pricingActive:true,isPublished:true,lmsStatus:'PUBLISHED',archivedAt:null,closedAt:null,trainingSessions:[]});
 s.db.whatsAppChatbotAiBudget={upsert:async()=>{},updateMany:async()=>({count:1})};
 const create=s.db.whatsAppConversationMessage.create;let next=0;
 s.db.whatsAppConversationMessage.create=args=>create({...args,data:{...args.data,id:++next}});
 const original=global.fetch;let apiCalls=0,observed;
 global.fetch=async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');apiCalls++;
  const input=JSON.parse(JSON.parse(options.body).input);observed={state:s.rows('metaWebhookEvent').at(-1).state,ids:input.facts.map(f=>f.id)};
  return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({language:'fr',factIds:['c1_payment']})}]}]})};
 };
 const worker=s.makeWorker();
 try{
  await s.receive('menu');await worker.runOnce();assert.equal(apiCalls,0);
  const option=s.rows('whatsAppConversation')[0].engineState.admission.options.find(o=>o.id==='question');
  await s.receive('',{type:'interactive',interactive:{button_reply:{id:option.wireId,title:'Poser une question'}}});await worker.runOnce();assert.equal(apiCalls,0);
  await s.receive('Je peux payer en deux fois ?');await worker.runOnce();assert.equal(apiCalls,1);assert.equal(observed.state,'PROCESSED');assert.ok(observed.ids.includes('c1_payment'));assert.match(s.sent.at(-1).text.body,/6e séance/);
  await s.receive('Menu');await worker.runOnce();assert.equal(apiCalls,1);assert.notEqual(s.rows('whatsAppConversation')[0].engineState.mode,'QUESTION_AI');
 }finally{global.fetch=original;await worker.close();}
});
