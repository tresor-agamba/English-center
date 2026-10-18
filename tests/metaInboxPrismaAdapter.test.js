const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createMetaInboxPrismaAdapter } = require('../src/services/metaInboxPrismaAdapter');
const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const { createMetaInboxDispatcher } = require('../src/services/metaInboxDispatcher');
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
const endpointId = '22222222-2222-4222-8222-222222222222';
const scope = { endpointId, environment: 'test', applicationKey: 'nva-test', metaAppId: '3001', wabaId: '2001', phoneNumberId: '1001' };
const phoneNumber = '+15555550123', secret = 'synthetic-only';
function setup() {
  const mock = createMetaInboxMock({ id: endpointId, ...scope, inboxEnabled: true, processingEnabled: true,
    normalizationVersion: 1, identityVersion: 1, lookupKeyVersion: 'l1', streamKeyVersion: 's1', disabledAt: null });
  const crypto = createMetaInboxCrypto({ lookupKeys: { l1: Buffer.alloc(32, 1) }, currentLookupVersion: 'l1',
    streamKey: Buffer.alloc(32, 2), streamKeyVersion: 's1', encryptionKeys: { e1: Buffer.alloc(32, 3) }, currentEncryptionVersion: 'e1' });
  const repository = createMetaInboxRepository({ database: mock.db, scope, crypto });
  const service = createMetaInboxService({ repository, scope, authentication: { secret, version: 'auth1' }, mode: 'isolated' });
  const config = { prospectFollowUp24hTemplate: 'synthetic24', prospectFollowUp72hTemplate: 'synthetic72' };
  const followUps = createWhatsAppProspectFollowUpService({ client: mock.db, configProvider: () => config, now: mock.time,
    sender: () => assert.fail('No transport allowed') });
  const conversationService = createWhatsAppConversationService({ client: mock.db, now: mock.time, followUps,
    followUpConfig: () => config, catalog: { listPublished: async () => [] },
    registration: { listCoursesForPublicRegistration: async () => [] },
    preferences: { recordWhatsAppOptOut: async (userId, tx) => {
      assert.equal(tx.$transaction, undefined);
      return tx.whatsAppPreference.updateMany({ where: { userId }, data: { hasOptedIn: false } });
    } } });
  const adapter = createMetaInboxPrismaAdapter({ endpointId, conversationService });
  const dispatcher = createMetaInboxDispatcher({ inboundTransaction: adapter });
  const message = (body = 'STOP', extra = {}) => ({ id: 'wamid.synthetic', from: phoneNumber.slice(1), type: 'text',
    timestamp: String(Math.floor(+mock.time() / 1000) - 1), text: { body }, ...extra });
  const context = () => ({ endpointId, firstReceivedAt: mock.time(), processedAt: mock.time() });
  const inTx = (msg = message(), ctx = context()) => mock.db.$transaction(tx => adapter(tx, msg, ctx), { isolationLevel: 'Serializable' });
  const seedConversation = (extra = {}) => mock.seed('whatsAppConversation', { id: 10, phoneNumber, controlState: 'BOT_ACTIVE', userId: null, engineState: {}, ...extra });
  async function receive(msg = message()) {
    const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: scope.wabaId,
      changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: scope.phoneNumberId }, messages: [msg] } }] }] }));
    return service.acceptRaw({ rawBody, signature: 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'), receivedAt: mock.time() });
  }
  return { ...mock, repository, adapter, dispatcher, message, context, inTx, seedConversation, receive };
}
test('adapter rejects invalid configuration and foreign endpoint before invoking engine', async () => {
  assert.throws(() => createMetaInboxPrismaAdapter(), { code: 'META_INBOX_INVALID_ADAPTER' });
  const s = setup();
  await assert.rejects(s.inTx(s.message(), { ...s.context(), endpointId: 'foreign' }), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' });
  assert.equal(s.rows('whatsAppConversationMessage').length, 0);
});
test('adapter refuses root client, missing clocks and a backwards processing clock', async () => {
  const s = setup();
  await assert.rejects(s.adapter(s.db, s.message(), s.context()), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' });
  await assert.rejects(s.inTx(s.message(), { endpointId }), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' });
  await assert.rejects(s.inTx(s.message(), { ...s.context(), processedAt: new Date(+s.time() - 1) }), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' });
});
test('actual STOP engine + cancellations + preference + inbox mark share one transaction', async () => {
  const s = setup(); s.seedConversation({ userId: 3 });
  s.seed('user', { id: 3, phoneNumber }); s.seed('whatsAppPreference', { userId: 3, phoneNumber, hasOptedIn: true });
  s.seed('whatsAppConversationMessage', { id: 20, conversationId: 10, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' });
  s.seed('whatsAppProspectFollowUp', { id: 30, conversationId: 10, status: 'PENDING' });
  await s.receive();
  const result = await s.repository.process(await s.repository.claim({ owner: 'test' }), s.dispatcher);
  assert.equal(result.state, 'PROCESSED'); assert.equal(s.rows('whatsAppConversation')[0].controlState, 'OPTED_OUT');
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'CANCELLED');
  assert.equal(s.rows('whatsAppProspectFollowUp')[0].status, 'CANCELLED');
  assert.equal(s.rows('whatsAppPreference')[0].hasOptedIn, false);
  assert.equal(s.rows('whatsAppCommercialConsentEvent')[0].decision, 'REVOKED');
  assert.equal(s.rows('whatsAppConversationMessage').filter(r => r.direction === 'OUTBOUND').length, 1);
});
test('failure after STOP effect rolls back business writes and keeps inbox retriable', async () => {
  const s = setup(); s.seedConversation(); await s.receive();
  const result = await s.repository.process(await s.repository.claim({ owner: 'test' }), async (...args) => {
    await s.dispatcher(...args); throw new Error('Synthetic failure after business effect');
  });
  assert.equal(result.state, 'RETRY_WAIT'); assert.equal(s.rows('whatsAppConversation')[0].controlState, 'BOT_ACTIVE');
  assert.equal(s.rows('whatsAppConversationMessage').length, 0); assert.equal(s.rows('whatsAppCommercialConsentEvent').length, 0);
  s.advance(3000);
  assert.equal((await s.repository.process(await s.repository.claim({ owner: 'replacement' }), s.dispatcher)).state, 'PROCESSED');
  assert.equal(s.rows('whatsAppCommercialConsentEvent').length, 1);
});
test('delayed consent uses first receipt clock and schedules actual service 24h/72h from receipt', async () => {
  const s = setup(), receipt = s.time();
  s.seedConversation({ engineState: { commercialFollowUpConsentRequestedAt: new Date(+receipt - 60000).toISOString() } });
  const msg = s.message('OUI RELANCES'); await s.receive(msg); s.advance(3 * 86400000);
  assert.equal((await s.repository.process(await s.repository.claim({ owner: 'test' }), s.dispatcher)).state, 'PROCESSED');
  assert.equal(s.rows('whatsAppCommercialConsentEvent')[0].decision, 'GRANTED');
  const rows = s.rows('whatsAppProspectFollowUp'); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => +r.scheduledFor), [24, 72].map(h => +receipt + h * 3600000));
  const inbound = s.rows('whatsAppConversationMessage').find(r => r.direction === 'INBOUND');
  assert.equal(+inbound.receivedAt, +receipt); assert.equal(+inbound.processedAt, +s.time());
  assert.equal(+inbound.processingStartedAt, +s.time());
});
for (const timestamp of [undefined, '9999999999']) test(`receipt-invalid timestamp remains unusable after delay: ${timestamp}`, async () => {
  const s = setup(), msg = s.message('STOP', { timestamp }); await s.receive(msg); s.advance(86400000);
  await s.repository.process(await s.repository.claim({ owner: 'test' }), s.dispatcher);
  assert.equal(s.rows('whatsAppConversationMessage')[0].providerTimestamp, null);
});
test('native duplicate has no second reply or consent effect', async () => {
  const s = setup(); await s.inTx(); const again = await s.inTx();
  assert.equal(again.duplicate, true); assert.equal(s.rows('whatsAppCommercialConsentEvent').length, 1);
  assert.equal(s.rows('whatsAppConversationMessage').length, 1);
});
for (const extra of [{ text: { body: 'different' } }, { from: '15555550124' }]) test(`conflicting native identity is refused: ${Object.keys(extra)[0]}`, async () => {
  const s = setup(); await s.inTx();
  await assert.rejects(s.inTx(s.message('STOP', extra)), { code: 'META_INBOX_NATIVE_IDENTIFIER_CONFLICT' });
  assert.equal(s.rows('whatsAppCommercialConsentEvent').length, 1);
});
for (const code of ['P2002', 'P2034']) test(`${code} escapes external engine adapter without nested retry`, async () => {
  const s = setup(); let attempts = 0;
  s.db.user.findMany = async () => { attempts++; throw Object.assign(new Error('synthetic'), { code }); };
  await assert.rejects(s.inTx(), { code }); assert.equal(attempts, 1);
  assert.equal(s.rows('whatsAppConversationMessage').length, 0);
});
test('human takeover remains effective with delayed inbound processing', async () => {
  const s = setup(); s.seedConversation({ controlState: 'HUMAN_TAKEOVER' });
  assert.equal((await s.inTx(s.message('bonjour'))).queuedResponses, 0);
  assert.equal(s.rows('whatsAppConversation')[0].controlState, 'HUMAN_TAKEOVER');
});
test('receipt counters satisfy proposed immediate sum CHECK even before item writes', async () => {
  const s = setup(), create = s.db.metaWebhookReceipt.create;
  s.db.metaWebhookReceipt.create = async input => {
    const r = input.data; assert.equal(r.itemCount, r.newCount + r.duplicateCount + r.conflictCount);
    return create(input);
  };
  const result = await s.receive(); assert.equal(result.itemCount, 1); assert.equal(result.newCount, 1);
});
