const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createGupshupDurableStore } = require('../src/services/providers/gupshupDurableStore');
const { createGupshupPayloadCipher } = require('../src/services/providers/gupshupPayloadCipher');
const { createPersistenceMock } = require('./helpers/gupshupPersistenceMock');
const applicationId = '11111111-1111-4111-8111-111111111111';
const application = { id: applicationId, provider: 'gupshup', applicationKey: 'sim-app', environment: 'test',
  apiFamily: 'messaging-wa-v1', webhookVersion: 2, inboundEnabled: false, outboundEnabled: false };
const scope = { applicationId, provider: 'gupshup', applicationKey: 'sim-app', environment: 'test' };
const event = (extra = {}) => ({ provider: 'gupshup', applicationKey: 'sim-app', kind: 'status',
  externalIds: { gupshup: 'sim-gs', whatsapp: 'sim-wa' }, data: { status: 'delivered' }, ...extra });
function setup() {
  const mock = createPersistenceMock(application);
  const codec = createGupshupPayloadCipher({ key: Buffer.alloc(32, 7), keyReference: 'synthetic-key-v1', applicationId });
  const reopen = () => createGupshupDurableStore({ database: mock.db, scope, codec });
  return { ...mock, codec, reopen, store: reopen() };
}
async function sending(s) {
  s.seed('whatsAppConversationMessage', { id: 1, direction: 'OUTBOUND', attempts: 1, deliveryStatus: 'PROCESSING' });
  const attempt = await s.store.prepareAttempt({ deliveryKind: 'conversation', deliveryId: 1, attemptNumber: 1,
    operationKey: 'synthetic-operation', payloadDigest: Buffer.alloc(32, 1) });
  return { attempt, dispatch: await s.store.beginDispatch(attempt.id) };
}
test('encrypted event committed, scoped and readable through a new repository', async () => {
  const s = setup(), receipt = await s.store.receiveSimulated(event());
  const row = await s.reopen().inspect(receipt.id);
  assert.equal(row.applicationId, applicationId); assert.equal(row.authenticationMethod, 'simulation');
  assert.equal(row.state, 'RECEIVED'); assert.equal(row.receiptCount, 1);
  assert.ok(!Buffer.from(row.payloadCiphertext).includes(Buffer.from('delivered')));
  assert.match(s.codec.open({ ciphertext: row.payloadCiphertext, keyReference: row.encryptionKeyReference }).toString(), /delivered/);
});
test('concurrent duplicate receipts have one identity and preserve first payload', async () => {
  const s = setup(); const receipts = await Promise.all(Array.from({ length: 8 }, () => s.store.receiveSimulated(event())));
  assert.equal(new Set(receipts.map(r => r.id)).size, 1); assert.equal(s.rows('providerWebhookEvent').length, 1);
  assert.equal((await s.store.inspect(receipts[0].id)).receiptCount, 8);
});
test('same identity with conflicting content quarantines without overwriting ciphertext', async () => {
  const s = setup(), first = await s.store.receiveSimulated(event());
  const before = await s.store.inspect(first.id);
  const conflict = await s.store.receiveSimulated(event({ data: { status: 'delivered', errors: [{ code: 'synthetic' }] } }));
  assert.equal(conflict.conflict, true); const after = await s.store.inspect(first.id);
  assert.equal(after.state, 'QUARANTINED'); assert.deepEqual(after.payloadCiphertext, before.payloadCiphertext);
});
test('inbound identity ignores local arrival and envelope clock changes', async () => {
  const s = setup(), e = event({ kind: 'inbound', externalIds: { whatsapp: 'sim-inbound' }, data: { text: 'synthetic' } });
  const a = await s.store.receiveSimulated(e); s.advance(1000);
  const b = await s.store.receiveSimulated({ ...e, receivedAt: new Date(), occurredAt: new Date() });
  assert.equal(a.id, b.id); assert.equal(b.duplicate, true);
});
test('unknown events and missing identifiers are retained in quarantine', async () => {
  const s = setup(); for (const e of [event({ kind: 'unsupported' }), event({ externalIds: {} })]) {
    const r = await s.store.receiveSimulated(e); assert.equal((await s.store.inspect(r.id)).state, 'QUARANTINED');
  }
});
test('real unauthenticated webhook refused before any storage access, even with trusted=true', async () => {
  const s = setup(); s.failNext('STORAGE_DOWN');
  await assert.rejects(s.store.receiveRealWebhook({ trusted: true, authenticationMethod: 'shared-header-confirmed' }), { code: 'GUPSHUP_WEBHOOK_AUTH_UNAVAILABLE' });
  assert.equal(s.rows('providerWebhookEvent').length, 0);
  await assert.rejects(s.store.receiveSimulated(event()), { code: 'STORAGE_DOWN' });
});
test('scope, provider and enabled simulation scope are checked', async () => {
  const s = setup();
  await assert.rejects(s.store.receiveSimulated(event({ applicationKey: 'other' })), { code: 'GUPSHUP_INVALID_EVENT' });
  await assert.rejects(s.store.receiveSimulated(event({ provider: 'meta' })), { code: 'GUPSHUP_INVALID_EVENT' });
  s.rows('providerApplication')[0].inboundEnabled = true;
  await assert.rejects(s.store.receiveSimulated(event()), { code: 'GUPSHUP_SIMULATION_SCOPE_ENABLED' });
  s.rows('providerApplication')[0].environment = 'staging';
  await assert.rejects(s.store.inspect(randomUUID()), { code: 'GUPSHUP_SCOPE_NOT_FOUND' });
});
test('storage and encryption failures are propagated without a success receipt', async () => {
  const s = setup(); s.failNext('STORAGE_DOWN');
  await assert.rejects(s.store.receiveSimulated(event()), { code: 'STORAGE_DOWN' });
  assert.equal(s.rows('providerWebhookEvent').length, 0);
  const broken = createGupshupDurableStore({ database: s.db, scope, codec: { seal() { throw new Error('CIPHER_DOWN'); } } });
  await assert.rejects(broken.receiveSimulated(event()), /CIPHER_DOWN/);
  assert.equal(s.rows('providerWebhookEvent').length, 0);
});
test('serialization abort retried only within storage transaction', async () => {
  const s = setup(); s.failNext('P2034');
  const r = await s.store.receiveSimulated(event()); assert.equal((await s.store.inspect(r.id)).receiptCount, 1);
});
test('two workers acquire only one lease; expired owner cannot resolve', async () => {
  const s = setup(); await s.store.receiveSimulated(event());
  const leases = await Promise.all([s.store.claim({ owner: 'worker-a', leaseMs: 1000 }), s.store.claim({ owner: 'worker-b', leaseMs: 1000 })]);
  assert.equal(leases.filter(Boolean).length, 1); const old = leases.find(Boolean);
  s.advance(1001); const fresh = await s.reopen().claim({ owner: 'worker-c' });
  assert.equal(fresh.generation, old.generation + 1n);
  await assert.rejects(s.store.resolve(old), { code: 'GUPSHUP_STALE_LEASE' });
  assert.equal((await s.store.resolve(fresh)).state, 'WAITING_CORRELATION');
});
test('early callback waits, response wakes it, persisted NVA binding determines readiness', async () => {
  const s = setup(), receipt = await s.store.receiveSimulated(event());
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'WAITING_CORRELATION');
  const { dispatch } = await sending(s);
  const response = await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  const first = await s.store.resolve(await s.store.claim({ owner: 'b' }));
  assert.equal(first.state, 'WAITING_BINDING'); assert.equal(first.ready, false);
  s.rows('whatsAppConversationMessage')[0].providerMessageId = response.providerMessageId;
  s.rows('whatsAppConversationMessage')[0].deliveryStatus = 'ACCEPTED'; s.advance(60001);
  const result = await s.reopen().resolve(await s.store.claim({ owner: 'c' }));
  assert.equal(result.ready, true); assert.equal(result.deliveryId, 1);
  assert.equal((await s.store.inspect(receipt.id)).state, 'WAITING_BINDING');
  assert.equal(s.rows('providerMessageAlias').length, 2);
});
test('lost response stays uncertain and impossible correlation never guesses by phone or time', async () => {
  const s = setup(), { dispatch } = await sending(s);
  await s.store.markUncertain(dispatch);
  await s.store.receiveSimulated(event({ externalIds: { gupshup: 'unknown' }, data: { status: 'delivered', phone: 'synthetic' } }));
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'WAITING_CORRELATION');
  await assert.rejects(s.store.beginDispatch(dispatch.attemptId), { code: 'GUPSHUP_DISPATCH_ALREADY_STARTED' });
  s.rows('whatsAppConversationMessage')[0].attempts = 2;
  await assert.rejects(s.store.prepareAttempt({ deliveryKind: 'conversation', deliveryId: 1, attemptNumber: 2,
    operationKey: 'new-op', payloadDigest: Buffer.alloc(32) }), { code: 'GUPSHUP_UNRESOLVED_ATTEMPT' });
});
test('dispatch CAS permits exactly one caller, even after process reconstruction', async () => {
  const s = setup(); s.seed('whatsAppConversationMessage', { id: 1, direction: 'OUTBOUND', attempts: 1, deliveryStatus: 'PROCESSING' });
  const data = { deliveryKind: 'conversation', deliveryId: 1, attemptNumber: 1, operationKey: 'op', payloadDigest: Buffer.alloc(32) };
  const a = await s.store.prepareAttempt(data), b = await s.reopen().prepareAttempt(data); assert.equal(a.id, b.id);
  const results = await Promise.allSettled([s.store.beginDispatch(a.id), s.reopen().beginDispatch(a.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('recovery preserves inbox and converts interrupted dispatch to uncertain, without resending', async () => {
  const s = setup(); await sending(s); const r = await s.store.receiveSimulated(event());
  await s.store.claim({ owner: 'dead', leaseMs: 1000 }); s.advance(2000);
  const result = await s.reopen().recover({ dispatchBefore: new Date('2026-10-16T12:00:01Z') });
  assert.equal(result.uncertainAttempts, 1); assert.equal(s.rows('providerSendAttempt')[0].state, 'UNCERTAIN');
  assert.equal((await s.reopen().claim({ owner: 'new' })).id, r.id);
});
test('payload expiration preserves tombstone and prevents processing', async () => {
  const s = setup(), r = await s.store.receiveSimulated(event()); s.advance(31 * 86400000);
  const result = await s.store.recover({ dispatchBefore: new Date('2026-10-16T12:00:00Z') });
  assert.equal(result.expiredEvents, 1); assert.equal((await s.store.inspect(r.id)).state, 'EXPIRED');
  assert.equal(await s.store.claim({ owner: 'a' }), null);
  assert.equal((await s.store.receiveSimulated(event())).duplicate, true);
});
test('conflicting identifier pair is quarantined, never reassigned', async () => {
  const s = setup(), { dispatch } = await sending(s);
  await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  s.seed('providerMessageAlias', { id: randomUUID(), applicationId, aliasType: 'whatsapp_message', externalId: 'sim-wa', attemptId: randomUUID() });
  await s.store.receiveSimulated(event());
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'QUARANTINED');
  assert.equal(s.rows('providerMessageAlias').length, 2);
});
test('known WhatsApp ID plus contradictory unknown Gupshup ID is quarantined', async () => {
  const s = setup(), { dispatch, attempt } = await sending(s);
  await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  s.seed('providerMessageAlias', { id: randomUUID(), applicationId, aliasType: 'whatsapp_message', externalId: 'sim-wa', attemptId: attempt.id });
  await s.store.receiveSimulated(event({ externalIds: { gupshup: 'contradiction', whatsapp: 'sim-wa' } }));
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'QUARANTINED');
});
test('target scope conflict and inbound targets cannot become provider deliveries', async () => {
  const s = setup(); s.seed('whatsAppConversationMessage', { id: 1, direction: 'INBOUND', attempts: 1, deliveryStatus: 'PROCESSING' });
  const data = { deliveryKind: 'conversation', deliveryId: 1, attemptNumber: 1, operationKey: 'op', payloadDigest: Buffer.alloc(32) };
  await assert.rejects(s.store.prepareAttempt(data), { code: 'GUPSHUP_INVALID_TARGET' });
  s.seed('providerDelivery', { id: randomUUID(), applicationId: randomUUID(), conversationMessageId: 1 });
  await assert.rejects(s.store.prepareAttempt(data), { code: 'GUPSHUP_TARGET_SCOPE_CONFLICT' });
});
test('cancelled NVA message is never marked ready or modified', async () => {
  const s = setup(), { dispatch } = await sending(s); const r = await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  const nva = s.rows('whatsAppConversationMessage')[0]; nva.providerMessageId = r.providerMessageId; nva.deliveryStatus = 'CANCELLED';
  await s.store.receiveSimulated(event());
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).ready, false);
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'CANCELLED');
});
test('cipher authenticates body, key version and application isolation', () => {
  const s = setup(), encrypted = s.codec.seal(Buffer.from('synthetic'));
  const other = createGupshupPayloadCipher({ key: Buffer.alloc(32, 7), keyReference: 'synthetic-key-v1', applicationId: randomUUID() });
  assert.throws(() => other.open(encrypted), /DECRYPTION_FAILED/);
  encrypted.ciphertext[encrypted.ciphertext.length - 1] ^= 1;
  assert.throws(() => s.codec.open(encrypted), /DECRYPTION_FAILED/);
  assert.throws(() => s.codec.open({ ...encrypted, keyReference: 'other' }), /INVALID_CIPHERTEXT/);
});

test('audit failure rolls back unresolved transition; lease remains recoverable', async () => {
  const s = setup(), receipt = await s.store.receiveSimulated(event());
  const lease = await s.store.claim({ owner: 'a' }); s.failCreate('providerReconciliationAudit');
  await assert.rejects(s.store.resolve(lease), { code: 'STORAGE_WRITE_FAILED' });
  assert.equal((await s.store.inspect(receipt.id)).state, 'PROCESSING');
  assert.equal(s.rows('providerReconciliationAudit').length, 0);
  await s.store.resolve(lease); assert.equal(s.rows('providerReconciliationAudit')[0].action, 'KEEP_UNRESOLVED');
});
test('failed alias write rolls back accepted response, leaving dispatch uncertain on recovery', async () => {
  const s = setup(), { dispatch } = await sending(s); s.failCreate('providerMessageAlias');
  await assert.rejects(s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' }), { code: 'STORAGE_WRITE_FAILED' });
  assert.equal(s.rows('providerSendAttempt')[0].state, 'DISPATCHING');
  assert.equal(s.rows('providerMessageAlias').length, 0);
  await s.store.markUncertain(dispatch); assert.equal(s.rows('providerSendAttempt')[0].state, 'UNCERTAIN');
});
test('unknown WhatsApp-only callback stays unresolved until an exact pair teaches its alias', async () => {
  const s = setup(); const early = await s.store.receiveSimulated(event({ externalIds: { whatsapp: 'sim-wa' } }));
  await s.store.resolve(await s.store.claim({ owner: 'a' }));
  const { dispatch } = await sending(s); await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  assert.equal((await s.store.inspect(early.id)).state, 'WAITING_CORRELATION');
  await s.store.receiveSimulated(event()); await s.store.resolve(await s.store.claim({ owner: 'b' }));
  assert.equal((await s.store.inspect(early.id)).state, 'RECEIVED');
});
test('processing retry does not change delivery attempts and reaches quarantine at its own limit', async () => {
  const s = setup(); await s.store.receiveSimulated(event());
  for (let i = 1; i <= 10; i++) {
    const lease = await s.store.claim({ owner: 'a' }); assert.ok(lease);
    const result = await s.store.defer(lease);
    assert.equal(result.state, i === 10 ? 'QUARANTINED' : 'RETRY_WAIT');
    s.advance(3600001);
  }
  assert.equal(s.rows('providerSendAttempt').length, 0); assert.equal(await s.store.claim({ owner: 'a' }), null);
});
test('delayed response can resolve uncertainty but cannot change an established submission ID', async () => {
  const s = setup(), { dispatch } = await sending(s); await s.store.markUncertain(dispatch);
  await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  assert.equal(s.rows('providerSendAttempt')[0].state, 'ACCEPTED');
  await assert.rejects(s.store.recordResponse({ ...dispatch, submissionId: 'different' }), { code: 'GUPSHUP_ALIAS_CONFLICT' });
  assert.equal(s.rows('providerSendAttempt')[0].submissionId, 'sim-gs');
});
test('foreign application aliases cannot resolve an event in the selected application', async () => {
  const s = setup(); s.seed('providerMessageAlias', { id: randomUUID(), applicationId: randomUUID(), aliasType: 'gupshup_submission', externalId: 'sim-gs', attemptId: randomUUID() });
  await s.store.receiveSimulated(event());
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'WAITING_CORRELATION');
});
test('stale active attempt never routes to the newer NVA delivery attempt', async () => {
  const s = setup(), { dispatch } = await sending(s); await s.store.recordResponse({ ...dispatch, submissionId: 'sim-gs' });
  s.rows('providerDelivery')[0].activeAttemptId = randomUUID();
  await s.store.receiveSimulated(event());
  assert.equal((await s.store.resolve(await s.store.claim({ owner: 'a' }))).state, 'QUARANTINED');
});
