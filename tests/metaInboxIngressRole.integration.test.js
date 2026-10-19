// Opt-in dedicated PostgreSQL role tests. No dotenv, production, HTTP or worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
if (process.env.NODE_ENV !== 'test' || process.env.NVA_META_INBOX_POSTGRES_TESTS !== 'dedicated-meta-inbox-reviewed'
  || process.env.NVA_SQL_TRANSACTION_USER !== 'nva_whatsapp_test_admin' || !process.env.NVA_SQL_TRANSACTION_PASSWORD) throw new Error('EXPLICIT_META_ROLE_TEST_REQUIRED');
const url = new URL('postgresql://127.0.0.1:55432/nva_whatsapp_test');
url.username = process.env.NVA_SQL_TRANSACTION_USER; url.password = process.env.NVA_SQL_TRANSACTION_PASSWORD;
delete process.env.NVA_SQL_TRANSACTION_PASSWORD;
global.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const { PrismaClient } = require('@prisma/client');
const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
const endpointId = randomUUID(), secret = 'synthetic-only-' + randomUUID();
const scope = { endpointId, environment: 'test', applicationKey: 'synthetic-role-' + endpointId,
  metaAppId: BigInt('0x' + endpointId.replaceAll('-', '')).toString(), wabaId: '2001', phoneNumberId: '1001' };
const crypto = createMetaInboxCrypto({ lookupKeys: { l1: randomBytes(32) }, currentLookupVersion: 'l1', streamKey: randomBytes(32),
  streamKeyVersion: 's1', encryptionKeys: { e1: randomBytes(32) }, currentEncryptionVersion: 'e1' });
const actor = { $transaction: (work, options) => db.$transaction(async tx => {
  await tx.$executeRawUnsafe('SET LOCAL ROLE nva_meta_inbox_ingress');
  assert.equal((await tx.$queryRaw`SELECT current_user AS role`)[0].role, 'nva_meta_inbox_ingress');
  return work(tx);
}, options) };
const compose = () => {
  const repo = createMetaInboxRepository({ database: actor, scope, crypto });
  return { repo, service: createMetaInboxService({ repository: repo, scope, authentication: { secret, version: 'a1' }, mode: 'isolated' }) };
};
const evidence = { endpointId, tests: [], role: 'nva_meta_inbox_ingress' }; let created = false;
function check(name, fn) {
  test(name, async () => { try { await fn(); evidence.tests.push({ name, passed: true }); }
    catch (e) { evidence.tests.push({ name, passed: false, code: e.code || 'TEST_FAILED' }); throw new Error('META_ROLE_TEST_FAILED: ' + name); } });
}
test.before(async () => {
  const [i] = await db.$queryRaw`SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,
    current_setting('data_directory') AS data,system_identifier::text FROM pg_control_system()`;
  assert.equal(i.db, 'nva_whatsapp_test'); assert.equal(i.host, '127.0.0.1'); assert.equal(i.port, 55432);
  assert.equal(i.data.replaceAll('\\', '/').toLowerCase(), 'd:/nva-whatsapp-test/data'); assert.equal(i.system_identifier, '7696610946073769572');
  evidence.identity = i;
  await db.metaWebhookEndpoint.create({ data: { id: endpointId, environment: 'test', applicationKey: scope.applicationKey,
    metaAppId: scope.metaAppId, wabaId: '2001', phoneNumberId: '1001', lookupKeyVersion: 'l1', streamKeyVersion: 's1', inboxEnabled: true, processingEnabled: false } }); created = true;
});
async function receive(value) {
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '2001', changes: [{ field: 'messages',
    value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, ...value } }] }] }));
  return compose().service.acceptRaw({ rawBody, signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'), receivedAt: new Date() });
}
const message = { id: 'wamid.role.' + endpointId, from: '15555550123', type: 'text', text: { body: 'STOP' } };
check('NOLOGIN role persists a signed STOP with real constraints and triggers', async () => {
  assert.equal((await receive({ messages: [message] })).accepted, true);
  assert.equal(await db.metaWebhookEvent.count({ where: { endpointId, state: 'READY' } }), 1);
});
check('column-limited role deduplicates a repeated STOP', async () => {
  assert.equal((await receive({ messages: [message] })).duplicateCount, 1);
  assert.equal(await db.metaWebhookEvent.count({ where: { endpointId } }), 1);
});
check('uncorrelated native callback is retained and readable after recomposition', async () => {
  await receive({ statuses: [{ id: 'wamid.unknown.' + endpointId, status: 'delivered' }] });
  const event = await db.metaWebhookEvent.findFirst({ where: { endpointId, kind: 'STATUS' } });
  assert.equal((await compose().repo.lookup(event.id)).nativeMessageId, event.nativeMessageId);
});
check('column-limited role retains conflicting duplicate content for review', async () => {
  const receipt = await receive({ messages: [{ ...message, text: { body: 'synthetic conflicting content' } }] });
  assert.equal(receipt.conflictCount, 1);
  const event = await db.metaWebhookEvent.findFirst({ where: { endpointId, kind: 'INBOUND' } });
  assert.equal(event.hasConflict, true); assert.equal(event.reviewRequired, true);
});
check('ingress role has no business, admin, CREATE, TEMP or DELETE capabilities', async () => {
  await actor.$transaction(async tx => {
    const [r] = await tx.$queryRaw`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
      has_table_privilege(current_user,'public.users','SELECT,INSERT,UPDATE,DELETE') AS business,
      has_table_privilege(current_user,'public.meta_webhook_events','DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS database_create
      FROM pg_roles WHERE rolname=current_user`;
    assert.ok(Object.values(r).every(value => value === false));
  });
});
test.after(async () => {
  try {
    if (created) await db.metaWebhookEndpoint.update({ where: { id: endpointId }, data: { inboxEnabled: false, processingEnabled: false, disabledAt: new Date() } });
    evidence.receipts = await db.metaWebhookReceipt.count({ where: { endpointId } });
    evidence.events = await db.metaWebhookEvent.count({ where: { endpointId } });
  } finally { fs.writeFileSync('output/meta-ingress-role-tests.json', JSON.stringify(evidence, null, 2)); await db.$disconnect(); }
});
