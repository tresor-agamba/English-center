// Dedicated local target only. SQL prerequisite: docs/sql/meta-inbox-schema-reviewed.sql.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const { Client } = require('pg');
process.chdir(path.resolve(__dirname, '..'));
for (const key of Object.keys(process.env)) if (/DATABASE_URL|^WHATSAPP_|^META_|^OPENAI_|^NVA_CHATBOT_/i.test(key)) delete process.env[key];
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: 'postgresql://nva_validation_app@127.0.0.1:56432/nva_admissions_validation_v2?schema=public&sslmode=disable', WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false', NVA_CHATBOT_AI_ENABLED: 'false' });
global.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const results = [];
let db, ingressDb;
async function check(name, fn) {
  try { await fn(); results.push({ name, status: 'PASS' }); }
  catch (e) { results.push({ name, status: 'FAIL', code: e.code || e.name, detail: require('../src/services/loggerService').sanitizeString(e.message).slice(-1000) }); }
  console.log(results.at(-1).status + ' ' + name);
}
async function main() {
  const c = new Client({ host: '127.0.0.1', port: 56432, database: 'nva_admissions_validation_v2', user: 'nva_validation_owner' }); await c.connect();
  const { rows: [i] } = await c.query("SELECT current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS dir"); await c.end();
  assert.equal(i.db, 'nva_admissions_validation_v2'); assert.equal(i.host, '127.0.0.1'); assert.equal(i.port, 56432); assert.equal(path.resolve(i.dir).toLowerCase(), path.resolve('output/postgres-validation/cluster').toLowerCase());
  db = require('../src/utils/prisma');
  ingressDb = new (require('@prisma/client').PrismaClient)({ datasourceUrl: process.env.DATABASE_URL.replace('nva_validation_app@', 'nva_validation_ingress@') });
  const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
  const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
  const { createMetaInboxService } = require('../src/services/metaInboxService');
  const { createMetaInboxDispatcher } = require('../src/services/metaInboxDispatcher');
  const { createMetaInboxPrismaAdapter } = require('../src/services/metaInboxPrismaAdapter');
  const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
  const endpointId = randomUUID(), secret = randomBytes(32).toString('hex');
  const scope = { endpointId, environment: 'test', applicationKey: 'local-validation-' + endpointId, metaAppId: BigInt('0x'+endpointId.replaceAll('-','')).toString(), wabaId: '2001', phoneNumberId: '1001' };
  const crypto = createMetaInboxCrypto({ lookupKeys: { l1: randomBytes(32) }, currentLookupVersion: 'l1', streamKey: randomBytes(32), streamKeyVersion: 's1', encryptionKeys: { e1: randomBytes(32) }, currentEncryptionVersion: 'e1' });
  await db.metaWebhookEndpoint.create({ data: { id: endpointId, environment: 'test', applicationKey: scope.applicationKey, metaAppId: scope.metaAppId, wabaId: scope.wabaId, phoneNumberId: scope.phoneNumberId, lookupKeyVersion: 'l1', streamKeyVersion: 's1', inboxEnabled: true, processingEnabled: true } });
  const repo = createMetaInboxRepository({ database: db, scope, crypto });
  const ingressRepo = createMetaInboxRepository({ database: ingressDb, scope, crypto });
  const inbox = createMetaInboxService({ repository: ingressRepo, scope, authentication: { secret, version: 'a1' }, mode: 'isolated' });
  await check('Meta ingress : droits par colonne sans accès métier ni DELETE/DDL', async () => {
    const [r] = await ingressDb.$queryRaw`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,
      has_table_privilege(current_user,'public.users','SELECT,INSERT,UPDATE,DELETE') AS business,
      has_table_privilege(current_user,'public."WhatsAppAdmissionRequest"','SELECT,INSERT,UPDATE,DELETE') AS admission,
      has_table_privilege(current_user,'public.meta_webhook_events','DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS database_create
      FROM pg_roles WHERE rolname=current_user`;
    assert.ok(Object.values(r).every(v => v === false));
    await assert.rejects(() => ingressDb.whatsAppAdmissionRequest.findMany(), e => e.code === 'P1010' || /permission denied/i.test(e.message));
  });
  const dispatcher = createMetaInboxDispatcher({ inboundTransaction: createMetaInboxPrismaAdapter({ endpointId, conversationService: createWhatsAppConversationService() }) });
  const phone = '+24389' + String(require('node:crypto').randomInt(1000000, 9999999));
  let last, message, lastSigned;
  async function receive(text, option) {
    const conv = await db.whatsAppConversation.findUnique({ where: { phoneNumber: phone } });
    const selected = option ? conv.engineState.admission.options.find(o => o.id === option) : null;
    assert.ok(!option || selected);
    const kind = last?.interactivePayload?.type === 'list' ? 'list_reply' : 'button_reply';
    message = { id: 'wamid.durable.' + randomUUID(), from: phone.slice(1), timestamp: String(Math.floor(Date.now() / 1000)), ...(option ? { type: 'interactive', interactive: { [kind]: { id: selected.wireId, title: 'Texte sans autorité' } } } : { type: 'text', text: { body: text } }) };
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: scope.wabaId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: scope.phoneNumberId }, messages: [message] } }] }] }));
    lastSigned = { rawBody, signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'), receivedAt: new Date() };
    const accepted = await inbox.acceptRaw(lastSigned); assert.equal(accepted.accepted, true);
    const lease = await repo.claim({ owner: 'explicit-test-step' }); assert.ok(lease);
    const result = await repo.process(lease, dispatcher); assert.equal(result.state, 'PROCESSED');
    last = await db.whatsAppConversationMessage.findUnique({ where: { idempotencyKey: 'wa-reply:' + message.id + ':0' } }); if(text!=='STOP')assert.ok(last); return result;
  }
  await check('Meta durable : réception signée, chiffrement et traitement PostgreSQL', async () => { await receive('bonjour'); const e = await db.metaWebhookEvent.findFirst({ where: { endpointId } }); assert.equal(e.state, 'PROCESSED'); assert.ok(e.normalizedPayloadCiphertext.length); assert.equal(e.effectOutcome, 'APPLIED'); });
  await check('Meta durable : liste Tarifs puis boutons OUI et administrateur', async () => { await receive('', 'price'); assert.match(last.body, /60 USD par niveau/); await receive('', 'yes'); await receive('', 'admin'); });
  let request;
  await check('Meta durable : collecte et confirmation créent une vraie demande', async () => {
    await receive('', 'accept'); await receive('Durable Validation'); await receive('', 'phone-confirm'); await receive('durable.validation@example.test'); await receive('', 'level-BEGINNER');
    assert.equal(await db.whatsAppAdmissionRequest.count({ where: { phoneNumber: phone } }), 0);
    await receive('', 'confirm'); request = await db.whatsAppAdmissionRequest.findUniqueOrThrow({ where: { sourceMessageId: message.id } }); assert.equal(request.status, 'PENDING');
    const e = await db.metaWebhookEvent.findFirst({ where: { endpointId, nativeMessageId: message.id } }); assert.equal(e.state, 'PROCESSED'); assert.equal(e.effectOutcome, 'APPLIED');
  });
  await check('Meta durable : doublon réception et effet unique', async () => { const r = await inbox.acceptRaw({ ...lastSigned, receivedAt: new Date() }); assert.equal(r.duplicateCount, 1); assert.equal(await db.whatsAppAdmissionRequest.count({ where: { phoneNumber: phone } }), 1); assert.equal(await db.metaWebhookEvent.count({ where: { endpointId, nativeMessageId: message.id } }), 1); });
  await check('Meta durable : mauvaise signature sans écriture', async () => { const count = await db.metaWebhookReceipt.count({ where: { endpointId } }); await assert.rejects(() => inbox.acceptRaw({ ...lastSigned, signature: 'sha256=' + '0'.repeat(64) })); assert.equal(await db.metaWebhookReceipt.count({ where: { endpointId } }), count); });
  await check('Meta durable : STOP annule les réponses en attente sans transport', async () => {
    await receive('STOP'); const conv = await db.whatsAppConversation.findUnique({ where: { phoneNumber: phone } }); assert.equal(conv.controlState, 'OPTED_OUT');
    assert.equal(await db.whatsAppConversationMessage.count({ where: { conversationId: conv.id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' } }), 0);
    assert.equal(await db.whatsAppCommercialConsentEvent.count({ where: { conversationId: conv.id, decision: 'REVOKED' } }), 1);
  });
  await db.metaWebhookEndpoint.update({ where: { id: endpointId }, data: { inboxEnabled: false, processingEnabled: false, disabledAt: new Date() } });
  await check('Meta durable : point de test désactivé après validation', async () => { const e = await db.metaWebhookEndpoint.findUnique({ where: { id: endpointId } }); assert.equal(e.inboxEnabled, false); assert.equal(e.processingEnabled, false); });
}
main().catch(e => results.push({ name: 'Harness completion', status: 'FAIL', code: e.code || e.name, detail: require('../src/services/loggerService').sanitizeString(e.message).slice(-1000) })).finally(async () => {
  if (db) await db.$disconnect();
  if (ingressDb) await ingressDb.$disconnect();
  fs.writeFileSync('output/postgres-validation/meta-results.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length }));
  process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
});
