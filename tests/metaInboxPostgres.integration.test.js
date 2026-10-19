// Explicit, opt-in dedicated PostgreSQL tests. No dotenv, routes or workers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHmac, createHash } = require('node:crypto');
if (process.env.NVA_META_INBOX_POSTGRES_TESTS !== 'dedicated-meta-inbox-reviewed'
  || process.env.NODE_ENV !== 'test' || process.env.NVA_SQL_TRANSACTION_USER !== 'nva_whatsapp_test_admin'
  || !process.env.NVA_SQL_TRANSACTION_PASSWORD) throw new Error('META_POSTGRES_EXPLICIT_TARGET_REQUIRED');
const url = new URL('postgresql://127.0.0.1:55432/nva_whatsapp_test');
url.username = process.env.NVA_SQL_TRANSACTION_USER; url.password = process.env.NVA_SQL_TRANSACTION_PASSWORD;
url.searchParams.set('schema', 'public'); url.searchParams.set('connection_limit', '8');
delete process.env.NVA_SQL_TRANSACTION_PASSWORD;
global.fetch = async () => { throw new Error('META_TEST_NETWORK_FORBIDDEN'); };
for (const mod of ['node:http', 'node:https']) {
  const http = require(mod); http.request = http.get = () => { throw new Error('META_TEST_NETWORK_FORBIDDEN'); };
}
const { PrismaClient } = require('@prisma/client');
const makeClient = () => new PrismaClient({ datasourceUrl: url.toString(), log: [] });
const db = makeClient();
// Keep all default application singletons on the explicitly verified test client.
const prismaPath = require.resolve('../src/utils/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
const { createMetaInboxDispatcher } = require('../src/services/metaInboxDispatcher');
const { createMetaInboxPrismaAdapter } = require('../src/services/metaInboxPrismaAdapter');
const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const { createWhatsAppConversationDeliveryService } = require('../src/services/whatsappConversationDeliveryService');
const { engageSubmission, ENGAGED } = require('../src/services/whatsappSubmissionCoordinator');
const { createWhatsAppDeliveryService } = require('../src/services/whatsappDeliveryService');
const evidence = { startedUtc: new Date().toISOString(), tests: [], storageErrors: [], retainedSyntheticEndpoints: [] };
const originalTransaction = db.$transaction.bind(db);
db.$transaction = async (...args) => {
  try { return await originalTransaction(...args); }
  catch (e) { evidence.storageErrors.push({ code: e.code, databaseCode: e.meta?.code,
    // Only fixed type names from a driver diagnostic, never SQL/payload/config.
    unsupportedVoid: /deserialize.*void|type.*void/i.test(String(e.meta?.message || e.message)) }); throw e; }
};
const base = JSON.parse(fs.readFileSync('output/meta-prisma-preflight.json', 'utf8'));
const config = { enabled: true, fakeMode: true, maxAttempts: 3, batchSize: 10 };
let s, identityVerified = false, serial = 0;
const priorEvidence = JSON.parse(fs.readFileSync('output/meta-inbox-postgres-tests.json', 'utf8'));
const ownedConversationIds = new Set(priorEvidence.ownedConversationIds || priorEvidence.final?.retainedConversationIds || []);
const ownedUserIds = new Set(priorEvidence.ownedUserIds || []);
const runDigits = BigInt('0x' + randomUUID().replaceAll('-', '')).toString().slice(0, 6);
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function caseTest(name, work) {
  test(name, { timeout: 20000 }, async () => {
    try { await work(); evidence.tests.push({ name, passed: true }); }
    catch (e) { evidence.tests.push({ name, passed: false, code: e.code || 'ASSERTION_FAILED', errorType: e.name,
      argument: String(e.message).match(/(?:Argument|argument) [`'"]([A-Za-z_][A-Za-z0-9_]*)[`'"]/)?.[1],
      location: String(e.stack).split('\n').find(line => /metaInboxPostgres.integration.test.js:\d+:\d+/.test(line))?.trim(),
      expected: typeof e.expected === 'number' ? e.expected : undefined,
      actual: typeof e.actual === 'number' ? e.actual : undefined });
      throw new Error(`META_TEST_FAILED: ${name}; ${e.code || 'ASSERTION_FAILED'}`); }
  });
}
async function verify(client) {
  const [i] = await client.$queryRaw`SELECT current_database() AS database,current_user AS role,
    host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('data_directory') AS data_directory,
    current_setting('server_version_num') AS version,pg_is_in_recovery() AS recovery,system_identifier::text
    FROM pg_control_system()`;
  assert.equal(i.database, 'nva_whatsapp_test'); assert.equal(i.role, 'nva_whatsapp_test_admin');
  assert.equal(i.address, '127.0.0.1'); assert.equal(i.port, 55432); assert.equal(i.version, '160015');
  assert.equal(i.system_identifier, '7696610946073769572'); assert.equal(i.recovery, false);
  assert.equal(i.data_directory.replaceAll('\\', '/').toLowerCase(), 'd:/nva-whatsapp-test/data'); return i;
}
function repository(client = db) { return createMetaInboxRepository({ database: client, scope: s.scope, crypto: s.crypto }); }
function stopMessage(id = randomUUID()) { return { id: `wamid.synthetic.${id}`, from: s.sender,
  timestamp: String(Math.floor(Date.now() / 1000) - 1), type: 'text', text: { body: 'STOP' } }; }
async function receive(value, service = s.service) {
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: s.scope.wabaId,
    changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: s.scope.phoneNumberId }, ...value } }] }] }));
  return service.acceptRaw({ rawBody, signature: 'sha256=' + createHmac('sha256', s.secret).update(rawBody).digest('hex'), receivedAt: new Date() });
}
async function receiveStop() { return receive({ messages: [stopMessage()] }); }
async function eventFor(receipt) { const item = await db.metaWebhookReceiptItem.findFirst({ where: { receiptId: receipt.receiptId } }); return db.metaWebhookEvent.findUnique({ where: { id: item.eventId } }); }
async function processNext(dispatcher = s.dispatcher) { const lease = await s.repo.claim({ owner: 'synthetic-worker' }); assert.ok(lease); return s.repo.process(lease, dispatcher); }
async function fixture() {
  const conversation = await db.whatsAppConversation.create({ data: { phoneNumber: '+' + s.sender, controlState: 'BOT_ACTIVE' } });
  s.conversationIds.push(conversation.id);
  await db.whatsAppConversationMessage.create({ data: { conversationId: conversation.id, direction: 'INBOUND',
    providerMessageId: 'wamid.window.' + randomUUID(), body: 'synthetic', processingStatus: 'PROCESSED',
    providerTimestamp: new Date(Date.now() - 1000) } });
  const message = await db.whatsAppConversationMessage.create({ data: { conversationId: conversation.id, direction: 'OUTBOUND',
    body: 'synthetic', deliveryStatus: 'QUEUED', idempotencyKey: 'synthetic:' + randomUUID(), updatedAt: new Date(Date.now() - 1000) } });
  return { conversation, message };
}
function delivery(sender, intercept) {
  const delegate = db.whatsAppConversationMessage;
  const model = intercept ? new Proxy(delegate, { get(target, key) {
    if (key === 'findUnique') return async args => intercept(await target.findUnique(args), args);
    return target[key];
  } }) : delegate;
  return createWhatsAppConversationDeliveryService({ client: { whatsAppConversationMessage: model, user: db.user,
    $transaction: db.$transaction.bind(db), $queryRaw: db.$queryRaw.bind(db) }, submissionBarrier: s.repo.canSubmitIn,
    sender, configProvider: () => config });
}
test.before(async () => {
  evidence.identity = await verify(db); identityVerified = true;
  assert.equal((await db.$queryRaw`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'provider_%'`)[0].n, 0);
});
test.beforeEach(async () => {
  assert.ok(identityVerified);
  const endpointId = randomUUID(); serial++;
  s = { sender: '1555' + runDigits + String(serial).padStart(4, '0'), secret: 'synthetic-only-' + randomUUID(), conversationIds: [],
    scope: { endpointId, environment: 'test', applicationKey: 'synthetic-' + endpointId,
      metaAppId: BigInt('0x' + endpointId.replaceAll('-', '')).toString(), wabaId: '2001', phoneNumberId: '1001' },
    crypto: createMetaInboxCrypto({ lookupKeys: { l1: randomBytes(32) }, currentLookupVersion: 'l1', streamKey: randomBytes(32),
      streamKeyVersion: 's1', encryptionKeys: { e1: randomBytes(32) }, currentEncryptionVersion: 'e1' }) };
  await db.metaWebhookEndpoint.create({ data: { id: endpointId, environment: 'test', applicationKey: s.scope.applicationKey,
    metaAppId: s.scope.metaAppId, wabaId: '2001', phoneNumberId: '1001', lookupKeyVersion: 'l1', streamKeyVersion: 's1', inboxEnabled: true, processingEnabled: true } });
  evidence.retainedSyntheticEndpoints.push(endpointId);
  s.repo = repository(); s.service = createMetaInboxService({ repository: s.repo, scope: s.scope,
    authentication: { secret: s.secret, version: 'synthetic-auth' }, mode: 'isolated' });
  const followUps = createWhatsAppProspectFollowUpService({ client: db, configProvider: () => config, sender: () => assert.fail('no sends') });
  const conversations = createWhatsAppConversationService({ client: db, followUps, followUpConfig: () => config,
    catalog: { listPublished: async () => [] }, registration: { listCoursesForPublicRegistration: async () => [] } });
  s.dispatcher = createMetaInboxDispatcher({ inboundTransaction: createMetaInboxPrismaAdapter({ endpointId, conversationService: conversations }) });
});
test.afterEach(async () => {
  if (!s || !identityVerified) return;
  // Retention triggers deliberately preserve synthetic inbox evidence; do not bypass them.
  await db.metaWebhookEndpoint.update({ where: { id: s.scope.endpointId }, data: { inboxEnabled: false, processingEnabled: false, disabledAt: new Date() } });
  const conversations = await db.whatsAppConversation.findMany({ where: { phoneNumber: '+' + s.sender }, select: { id: true } });
  for (const row of conversations) ownedConversationIds.add(row.id);
  evidence.ownedConversationIds = [...ownedConversationIds];
  evidence.ownedUserIds = [...ownedUserIds];
  // No deletions are authorized in this mission. Retain all synthetic fixtures.
});
test.after(async () => {
  try {
    if (identityVerified) {
      await verify(db);
      const migrations = await db.$queryRaw`SELECT migration_name AS name, checksum FROM public._prisma_migrations ORDER BY migration_name`;
      assert.deepEqual(migrations, base.baseline.migrations.map(({ name, checksum }) => ({ name, checksum })));
      await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      for (const table of base.baseline.data.filter(x => !/^meta_webhook_/.test(x.name))) {
        assert.match(table.name, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
        const userOwned = ['users', 'whatsapp_preferences', 'whatsapp_deliveries', 'notifications'].includes(table.name);
        const column = userOwned ? (table.name === 'users' ? 'id' : 'user_id') : table.name === 'whatsapp_conversations' ? 'id' : ['whatsapp_conversation_messages', 'whatsapp_commercial_consent_events', 'whatsapp_prospect_follow_ups'].includes(table.name) ? 'conversation_id' : null;
        const owned = [...(userOwned ? ownedUserIds : ownedConversationIds)];
        const exclude = column && owned.length ? ` WHERE ${column} NOT IN (${owned.map(id => { assert.ok(Number.isSafeInteger(id)); return id; }).join(',')})` : '';
        const [row] = await tx.$queryRawUnsafe(`SELECT count(*)::text AS rows,encode(sha256(convert_to(coalesce(string_agg(d,'|' ORDER BY d),''),'UTF8')),'hex') AS digest FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS d FROM public."${table.name}" t${exclude}) x`);
        assert.equal(row.rows, table.rows); assert.equal(row.digest, table.digest);
      }
      }, { timeout: 15000 });
      evidence.final = { historicalMigrationsUnchanged: 44, businessTablesPreservedOutsideOwnedFixtures: 69,
        retainedConversationIds: [...ownedConversationIds],
        endpoints: await db.metaWebhookEndpoint.count(), events: await db.metaWebhookEvent.count(),
        receipts: await db.metaWebhookReceipt.count(), items: await db.metaWebhookReceiptItem.count(),
        enabledEndpoints: await db.metaWebhookEndpoint.count({ where: { OR: [{ inboxEnabled: true }, { processingEnabled: true }] } }) };
      assert.equal(evidence.final.enabledEndpoints, 0);
    }
  } finally {
    evidence.finishedUtc = new Date().toISOString();
    fs.writeFileSync('output/meta-inbox-postgres-tests.json', JSON.stringify(evidence, null, 2)); await db.$disconnect();
  }
});

caseTest('real client persists encrypted events and committed receipt manifests', async () => {
  const receipt = await receiveStop(); const event = await eventFor(receipt);
  assert.equal(event.kind, 'INBOUND'); assert.equal(event.state, 'READY');
  assert.ok(event.normalizedPayloadCiphertext instanceof Uint8Array);
  assert.ok(!Buffer.from(event.normalizedPayloadCiphertext).includes(Buffer.from('STOP')));
  assert.equal((await db.metaWebhookReceiptItem.count({ where: { receiptId: receipt.receiptId } })), 1);
});
caseTest('deduplication persists two receipts but only one event', async () => {
  const message = stopMessage(); await receive({ messages: [message] }); const second = await receive({ messages: [message] });
  assert.equal(second.duplicateCount, 1); assert.equal(await db.metaWebhookEvent.count({ where: { endpointId: s.scope.endpointId } }), 1);
});
caseTest('atomic batch rolls back all rows after an injected storage failure', async () => {
  let calls = 0;
  const faulty = { $transaction: (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) {
    if (key === 'metaWebhookReceiptItem') return new Proxy(target[key], { get(model, method) {
      if (method === 'create') return args => { if (++calls === 2) throw new Error('synthetic-storage-failure'); return model.create(args); };
      return model[method];
    } }); return target[key];
  } })), options) };
  const service = createMetaInboxService({ repository: repository(faulty), scope: s.scope,
    authentication: { secret: s.secret, version: 'synthetic-auth' }, mode: 'isolated' });
  await assert.rejects(receive({ messages: [stopMessage(), stopMessage()] }, service), { code: 'META_INBOX_STORAGE_FAILED' });
  assert.equal(await db.metaWebhookEvent.count({ where: { endpointId: s.scope.endpointId } }), 0);
  assert.equal(await db.metaWebhookReceipt.count({ where: { endpointId: s.scope.endpointId } }), 0);
});
caseTest('concurrent duplicate acceptance has one event and no silent loss', async () => {
  const message = stopMessage(); const receipts = await Promise.all([receive({ messages: [message] }), receive({ messages: [message] })]);
  assert.equal(receipts.reduce((n, x) => n + x.newCount, 0), 1); assert.equal(receipts.reduce((n, x) => n + x.duplicateCount, 0), 1);
});
caseTest('uncorrelated callback remains durable then is applied after exact correlation', async () => {
  const id = 'wamid.callback.' + randomUUID(); const receipt = await receive({ statuses: [{ id, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] });
  const event = await eventFor(receipt); assert.equal((await processNext()).state, 'UNCORRELATED');
  const { message } = await fixture(); await db.whatsAppConversationMessage.update({ where: { id: message.id }, data: { deliveryStatus: 'ACCEPTED', providerMessageId: id } });
  await s.repo.wake({ nativeMessageId: id }); assert.equal((await processNext()).state, 'PROCESSED');
  assert.equal((await db.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).deliveryStatus, 'DELIVERED');
  assert.equal((await s.repo.lookup(event.id)).state, 'PROCESSED');
});
caseTest('late callbacks cannot regress READ status', async () => {
  const id = 'wamid.late.' + randomUUID(); const { message } = await fixture();
  await db.whatsAppConversationMessage.update({ where: { id: message.id }, data: { deliveryStatus: 'READ', providerMessageId: id } });
  await receive({ statuses: [{ id, status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] });
  assert.equal((await processNext()).state, 'IGNORED');
  assert.equal((await db.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).deliveryStatus, 'READ');
});
caseTest('effect error rolls back business effect and records retry state', async () => {
  const { conversation } = await fixture(); await receiveStop();
  assert.equal((await processNext(async tx => { await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { controlState: 'CLOSED' } }); throw new Error('synthetic'); })).state, 'RETRY_WAIT');
  assert.equal((await db.whatsAppConversation.findUnique({ where: { id: conversation.id } })).controlState, 'BOT_ACTIVE');
});
caseTest('independent connection sees no uncommitted business update', async () => {
  const { conversation } = await fixture(); const observer = makeClient(); await verify(observer);
  try {
    await assert.rejects(db.$transaction(async tx => {
      await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { controlState: 'CLOSED' } });
      assert.equal((await observer.whatsAppConversation.findUnique({ where: { id: conversation.id } })).controlState, 'BOT_ACTIVE'); throw new Error('synthetic-rollback');
    }), /synthetic-rollback/);
  } finally { await observer.$disconnect(); }
});
caseTest('STOP committed before send prevents the injected transport call', async () => {
  const { message, conversation } = await fixture(); await receiveStop(); assert.equal((await processNext()).state, 'PROCESSED');
  assert.equal((await db.whatsAppConversation.findUnique({ where: { id: conversation.id } })).controlState, 'OPTED_OUT');
  let sends = 0; await delivery(async () => { sends++; return { providerMessageId: 'never' }; }).sendMessage(message.id); assert.equal(sends, 0);
});
caseTest('pending STOP blocks the repository simulated submission protocol', async () => {
  await receiveStop(); let sends = 0;
  const result = await s.repo.simulateDispatch({ sender: s.sender, mode: 'isolated', claimAndSubmitMock: async () => { sends++; } });
  assert.equal(result.blocked, true); assert.equal(sends, 0);
});
caseTest('STOP during preparation is seen by the delivery final database check', async () => {
  const { message } = await fixture(); const paused = gate(), resume = gate(); let reads = 0, sends = 0;
  const task = delivery(async () => { sends++; return { providerMessageId: 'never' }; }, async row => {
    if (++reads === 1) { paused.resolve(); await resume.promise; } return row;
  }).sendMessage(message.id);
  try { await paused.promise; await receiveStop(); await processNext(); } finally { resume.resolve(); }
  await task; assert.equal(sends, 0);
});
caseTest('STOP after final read must prevent a newly submitted send (activation requirement)', async () => {
  const { message } = await fixture(); const paused = gate(), resume = gate(); let reads = 0, sends = 0;
  const task = delivery(async () => { sends++; return { providerMessageId: 'wamid.race.' + randomUUID() }; }, async row => {
    if (++reads === 2) { paused.resolve(); await resume.promise; } return row;
  }).sendMessage(message.id);
  try { await paused.promise; await receiveStop(); await processNext(); } finally { resume.resolve(); }
  await task; assert.equal(sends, 0);
});
caseTest('STOP during an already engaged mock network call prevents subsequent sends', async () => {
  const { message } = await fixture(); const engaged = gate(), finish = gate(); let sends = 0;
  const service = delivery(async () => { sends++; engaged.resolve(); await finish.promise; return { providerMessageId: 'wamid.engaged.' + randomUUID() }; });
  const task = service.sendMessage(message.id);
  try { await engaged.promise; await receiveStop(); await processNext(); } finally { finish.resolve(); }
  await task; await service.sendMessage(message.id); assert.equal(sends, 1);
});
caseTest('simultaneous STOP messages produce one revoked state and no sends', async () => {
  const { conversation, message } = await fixture();
  await Promise.all([receiveStop(), receiveStop()]); await processNext(); await processNext();
  assert.equal((await db.whatsAppConversation.findUnique({ where: { id: conversation.id } })).controlState, 'OPTED_OUT');
  let sends = 0; await delivery(async () => { sends++; }).sendMessage(message.id); assert.equal(sends, 0);
});
caseTest('two concurrent workers cannot acquire the same event lease', async () => {
  await receiveStop(); const leases = await Promise.all([s.repo.claim({ owner: 'a' }), s.repo.claim({ owner: 'b' })]);
  assert.equal(leases.filter(Boolean).length, 1);
});
caseTest('two concurrent delivery calls perform only one simulated submission', async () => {
  const { message } = await fixture(); let sends = 0;
  const service = delivery(async () => { sends++; return { providerMessageId: 'wamid.one-send.' + randomUUID() }; });
  await Promise.all([service.sendMessage(message.id), service.sendMessage(message.id)]);
  assert.equal(sends, 1);
});
caseTest('STOP acceptance waits for an existing simulated reservation and blocks the next one', async () => {
  const entered = gate(), release = gate(); let sends = 0, stopPid;
  const producer = makeClient(); await verify(producer);
  const wrapped = { $transaction: (work, options) => producer.$transaction(async tx => {
    [stopPid] = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`).map(x => x.pid); return work(tx);
  }, options) };
  const service = createMetaInboxService({ repository: repository(wrapped), scope: s.scope,
    authentication: { secret: s.secret, version: 'synthetic-auth' }, mode: 'isolated' });
  const submission = s.repo.simulateDispatch({ sender: s.sender, mode: 'isolated', claimAndSubmitMock: async () => {
    entered.resolve(); await release.promise; sends++; return { mockSubmitted: true };
  } });
  let stop;
  try {
    await entered.promise; stop = receive({ messages: [stopMessage()] }, service);
    // Observe a real PostgreSQL lock wait, not timing-based mock serialization.
    const deadline = Date.now() + 2000; let waiting = false;
    while (Date.now() < deadline && !waiting) {
      if (stopPid) waiting = (await db.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${stopPid}`)[0]?.wait_event_type === 'Lock';
      else await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(waiting, true);
  } finally {
    release.resolve(); await submission; if (stop) await stop; await producer.$disconnect();
  }
  assert.equal((await s.repo.simulateDispatch({ sender: s.sender, mode: 'isolated', claimAndSubmitMock: async () => { sends++; } })).blocked, true);
  assert.equal(sends, 1);
});
caseTest('expired lease is reclaimed by a fresh client and old owner is fenced', async () => {
  const receipt = await receiveStop(); const event = await eventFor(receipt); const lease = await s.repo.claim({ owner: 'interrupted', leaseMs: 1000 });
  await db.metaWebhookEvent.update({ where: { id: event.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
  const fresh = makeClient();
  try {
    await verify(fresh); const restored = repository(fresh); const next = await restored.claim({ owner: 'replacement' });
    assert.equal(next.id, lease.id); assert.equal(next.generation, lease.generation + 1n);
    await assert.rejects(s.repo.process(lease, s.dispatcher), { code: 'META_INBOX_STALE_LEASE' });
    assert.equal((await restored.process(next, s.dispatcher)).state, 'PROCESSED');
  } finally { await fresh.$disconnect(); }
});
caseTest('durable pending STOP survives producer disconnect and blocks another sender', async () => {
  const producer = makeClient();
  try {
    await verify(producer);
    const service = createMetaInboxService({ repository: repository(producer), scope: s.scope,
      authentication: { secret: s.secret, version: 'synthetic-auth' }, mode: 'isolated' });
    await receive({ messages: [stopMessage()] }, service);
  } finally { await producer.$disconnect(); }
  const fresh = makeClient();
  try {
    await verify(fresh); const restored = repository(fresh); assert.equal((await restored.inspectBarrier(s.sender)).blocked, true);
    let sends = 0; assert.equal((await restored.simulateDispatch({ sender: s.sender, mode: 'isolated', claimAndSubmitMock: async () => { sends++; } })).blocked, true);
    assert.equal(sends, 0);
  } finally { await fresh.$disconnect(); }
});

async function reserve(message) {
  await db.whatsAppConversationMessage.update({ where: { id: message.id }, data: { deliveryStatus: 'PROCESSING',
    attempts: 1, processingStartedAt: new Date(), failureCode: null } });
}
function engageArgs(message, client = db) {
  return { database: client, kind: 'conversation', id: message.id, attempts: 1, phoneNumber: '+' + s.sender,
    config, barrier: s.repo.canSubmitIn };
}
caseTest('registered pending STOP prevents durable engagement before processing', async () => {
  const { message } = await fixture(); await receiveStop(); let sends = 0;
  await delivery(async () => { sends++; return { providerMessageId: 'never' }; }).sendMessage(message.id);
  assert.equal(sends, 0);
});
caseTest('commit is the engagement boundary; network runs outside every SQL transaction', async () => {
  const { message } = await fixture(); let calls = 0;
  await delivery(async () => {
    calls++;
    assert.equal((await db.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).failureCode, ENGAGED);
    const [row] = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname=current_database() AND state='idle in transaction'`;
    assert.equal(row.n, 0);
    return { providerMessageId: 'wamid.no-tx.' + randomUUID() };
  }).sendMessage(message.id); assert.equal(calls, 1);
});
caseTest('STOP before network but after committed engagement cannot revoke the existing intent', async () => {
  const { message } = await fixture(); await reserve(message);
  assert.equal(await engageSubmission(engageArgs(message)), true);
  await receiveStop(); await processNext();
  const row = await db.whatsAppConversationMessage.findUnique({ where: { id: message.id } });
  assert.equal(row.failureCode, ENGAGED);
  assert.equal(await engageSubmission(engageArgs(message)), false); // No NEW authorization.
  // An existing intent may still reach the wire; the coordinator never calls a sender itself.
});
caseTest('crash while reserved is recovered conservatively without automatic send', async () => {
  const { message } = await fixture(); await reserve(message);
  const service = createWhatsAppConversationDeliveryService({ client: db, configProvider: () => config,
    submissionBarrier: s.repo.canSubmitIn, now: () => new Date(Date.now() + 16 * 60000), sender: () => assert.fail('no replay') });
  await service.recoverAbandoned();
  const row = await db.whatsAppConversationMessage.findUnique({ where: { id: message.id } });
  assert.equal(row.deliveryStatus, 'FAILED'); assert.equal(row.failureCode, 'DELIVERY_UNCERTAIN');
  assert.equal(await engageSubmission(engageArgs(message)), false);
});
caseTest('crash after durable engagement is not replayed by a fresh client', async () => {
  const { message } = await fixture(); await reserve(message);
  assert.equal(await engageSubmission(engageArgs(message)), true);
  const fresh = makeClient();
  try {
    await verify(fresh); assert.equal(await engageSubmission(engageArgs(message, fresh)), false);
    const service = createWhatsAppConversationDeliveryService({ client: fresh, configProvider: () => config,
      now: () => new Date(Date.now() + 16 * 60000), sender: () => assert.fail('no replay') });
    await service.recoverAbandoned(); assert.equal((await fresh.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).failureCode, 'DELIVERY_UNCERTAIN');
  } finally { await fresh.$disconnect(); }
});
caseTest('uncertain simulated network outcome cannot create a duplicate after restart', async () => {
  const { message } = await fixture(); let calls = 0;
  const sender = async () => { calls++; throw Object.assign(new Error('synthetic-timeout'), { uncertain: true, code: 'DELIVERY_UNCERTAIN' }); };
  await delivery(sender).sendMessage(message.id);
  const fresh = makeClient();
  try {
    await verify(fresh); const service = createWhatsAppConversationDeliveryService({ client: fresh, sender,
      configProvider: () => config, submissionBarrier: s.repo.canSubmitIn });
    await service.sendMessage(message.id); assert.equal(calls, 1);
    assert.equal((await fresh.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).deliveryStatus, 'FAILED');
  } finally { await fresh.$disconnect(); }
});
caseTest('two independent Node processes cannot commit the same engagement twice', async () => {
  const { message } = await fixture(); await reserve(message);
  const { spawn } = require('node:child_process');
  function child() {
    return new Promise((resolve, reject) => {
      const env = { NODE_ENV: 'test', NVA_META_INBOX_POSTGRES_TESTS: 'dedicated-meta-inbox-reviewed',
        NVA_COORDINATOR_TEST_URL: url.toString(), SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP };
      const p = spawn(process.execPath, [path.join(__dirname, 'helpers/whatsappSubmissionChild.cjs')],
        { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 });
      let output = ''; p.stdout.on('data', chunk => { output += chunk; }); p.stderr.resume();
      p.on('error', () => reject(new Error('CHILD_START_FAILED')));
      p.on('exit', code => { if (code !== 0) return reject(new Error('CHILD_FAILED')); try { resolve(JSON.parse(output)); } catch { reject(new Error('CHILD_OUTPUT_FAILED')); } });
      p.stdin.end(JSON.stringify({ id: message.id, phoneNumber: '+' + s.sender, endpointId: s.scope.endpointId }));
    });
  }
  const results = await Promise.all([child(), child()]); assert.equal(results.filter(result => result.engaged).length, 1);
});
caseTest('prospect STOP after final read prevents template submission', async () => {
  const { conversation } = await fixture();
  const consent = await db.whatsAppCommercialConsentEvent.create({ data: { conversationId: conversation.id,
    scope: 'COMMERCIAL_FOLLOW_UPS', decision: 'GRANTED', source: 'ADMIN_RECORDED', occurredAt: new Date(Date.now() - 1000), deduplicationKey: 'synthetic-consent:' + randomUUID() } });
  const follow = await db.whatsAppProspectFollowUp.create({ data: { conversationId: conversation.id, consentEventId: consent.id,
    sequenceHours: 24, templateName: 'synthetic24', deduplicationKey: 'synthetic-follow:' + randomUUID(), scheduledFor: new Date(Date.now() - 1000) } });
  const paused = gate(), resume = gate(); let reads = 0, sends = 0;
  const model = new Proxy(db.whatsAppProspectFollowUp, { get(target, key) {
    if (key === 'findUnique') return async args => { const row = await target.findUnique(args); if (++reads === 2) { paused.resolve(); await resume.promise; } return row; };
    return target[key];
  } });
  const client = { whatsAppProspectFollowUp: model, whatsAppCommercialConsentEvent: db.whatsAppCommercialConsentEvent,
    user: db.user, enrollment: db.enrollment, $transaction: db.$transaction.bind(db), $queryRaw: db.$queryRaw.bind(db) };
  const service = createWhatsAppProspectFollowUpService({ client, submissionBarrier: s.repo.canSubmitIn,
    configProvider: () => ({ ...config, prospectFollowUp24hTemplate: 'synthetic24', prospectFollowUp72hTemplate: 'synthetic72' }),
    sender: async () => { sends++; return { providerMessageId: 'never' }; } });
  const task = service.sendFollowUp(follow.id);
  try { await paused.promise; await receiveStop(); await processNext(); } finally { resume.resolve(); }
  await task; assert.equal(sends, 0);
});
caseTest('notification STOP after final read prevents template submission', async () => {
  const { conversation } = await fixture();
  const user = await db.user.create({ data: { firstName: 'Synthetic', lastName: 'Fixture', phoneNumber: '+' + s.sender,
    passwordHash: 'non-authentication-fixture:' + randomUUID(), mustChangePassword: true } });
  ownedUserIds.add(user.id);
  await db.whatsAppConversation.update({ where: { id: conversation.id }, data: { userId: user.id } });
  await db.whatsAppPreference.create({ data: { userId: user.id, phoneNumber: '+' + s.sender, isEnabled: true, hasOptedIn: true } });
  const notification = await db.notification.create({ data: { userId: user.id, type: 'PAYMENT_REQUIRED', title: 'synthetic', message: 'synthetic' } });
  const row = await db.whatsAppDelivery.create({ data: { userId: user.id, notificationId: notification.id, phoneNumber: '+' + s.sender,
    templateName: 'synthetic', templateLanguage: 'fr', deduplicationKey: 'synthetic-notification:' + randomUUID(), scheduledFor: new Date(Date.now() - 1000) } });
  const paused = gate(), resume = gate(); let reads = 0, sends = 0;
  const model = new Proxy(db.whatsAppDelivery, { get(target, key) {
    if (key === 'findUnique') return async args => { const row = await target.findUnique(args); if (++reads === 2) { paused.resolve(); await resume.promise; } return row; };
    return target[key];
  } });
  const service = createWhatsAppDeliveryService({ client: { whatsAppDelivery: model, notification: db.notification,
    $transaction: db.$transaction.bind(db), $queryRaw: db.$queryRaw.bind(db) }, submissionBarrier: s.repo.canSubmitIn, configProvider: () => config,
    preferences: { canReceiveWhatsApp: async () => ({ phoneNumber: '+' + s.sender }) },
    sender: async () => { sends++; return { providerMessageId: 'never' }; } });
  const task = service.sendDelivery(row.id);
  try { await paused.promise; await receiveStop(); await processNext(); } finally { resume.resolve(); }
  await task; assert.equal(sends, 0);
  assert.equal((await db.whatsAppPreference.findUnique({ where: { userId: user.id } })).hasOptedIn, false);
});
caseTest('terminated process during fake network call leaves no replayable authorization', async () => {
  const { message } = await fixture(); await reserve(message);
  const { spawn } = require('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'helpers/whatsappSubmissionChild.cjs')], {
      env: { NODE_ENV: 'test', NVA_META_INBOX_POSTGRES_TESTS: 'dedicated-meta-inbox-reviewed',
        NVA_COORDINATOR_TEST_URL: url.toString(), SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP },
      windowsHide: true, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', networkStarted = false; p.stderr.resume();
    p.on('error', () => reject(new Error('TEST_CHILD_START_FAILED')));
    p.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) {
        try { networkStarted = JSON.parse(output.trim()).mockNetworkStarted === true; } catch { /* wait for complete frame */ }
        if (networkStarted) p.kill();
      }
    });
    p.on('exit', () => networkStarted ? resolve() : reject(new Error('TEST_CHILD_NOT_ENGAGED')));
    p.stdin.end(JSON.stringify({ id: message.id, phoneNumber: '+' + s.sender,
      endpointId: s.scope.endpointId, simulateNetworkCrash: true }));
  });
  const fresh = makeClient();
  try {
    await verify(fresh);
    assert.equal((await fresh.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).failureCode, ENGAGED);
    assert.equal(await engageSubmission(engageArgs(message, fresh)), false);
    const service = createWhatsAppConversationDeliveryService({ client: fresh, configProvider: () => config,
      now: () => new Date(Date.now() + 16 * 60000), sender: () => assert.fail('no replay after crash') });
    await service.recoverAbandoned();
    assert.equal((await fresh.whatsAppConversationMessage.findUnique({ where: { id: message.id } })).failureCode, 'DELIVERY_UNCERTAIN');
  } finally { await fresh.$disconnect(); }
});
caseTest('a mismatched inbox key configuration cannot hide a STOP barrier', async () => {
  const { message } = await fixture(); await reserve(message);
  await db.metaWebhookEndpoint.update({ where: { id: s.scope.endpointId }, data: { lookupKeyVersion: 'unconfigured-version' } });
  assert.equal(await engageSubmission(engageArgs(message)), false);
});
