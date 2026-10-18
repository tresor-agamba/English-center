const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { createMetaInboxCrypto } = require('../src/services/metaInboxProtocol');
const { createMetaInboxRepository } = require('../src/repositories/metaInboxRepository');
const { createMetaInboxService } = require('../src/services/metaInboxService');
const { createMetaInboxDispatcher } = require('../src/services/metaInboxDispatcher');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
const endpointId = '22222222-2222-4222-8222-222222222222';
const scope = { endpointId, environment: 'test', applicationKey: 'nva-test', metaAppId: '3001', wabaId: '2001', phoneNumberId: '1001' };
const sender = '15555550123', secret = 'synthetic-meta-secret-only';
const keys = { lookupKeys: { l1: Buffer.alloc(32, 1) }, currentLookupVersion: 'l1', streamKey: Buffer.alloc(32, 2), streamKeyVersion: 's1',
  encryptionKeys: { e1: Buffer.alloc(32, 3) }, currentEncryptionVersion: 'e1' };
const incoming = (body = 'STOP', id = 'wamid.inbound') => ({ messages: [{ id, from: sender, type: 'text', timestamp: '1792151999', text: { body } }] });
const callback = (extra = {}) => ({ statuses: [{ id: 'wamid.outbound', status: 'delivered', timestamp: '1792151999', ...extra }] });
const envelope = value => ({ object: 'whatsapp_business_account', entry: [{ id: scope.wabaId, changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: scope.phoneNumberId }, ...value } }] }] });
function setup(options = {}) {
  const endpoint = { id: endpointId, ...scope, inboxEnabled: true, processingEnabled: true, normalizationVersion: 1, identityVersion: 1,
    lookupKeyVersion: 'l1', streamKeyVersion: 's1', disabledAt: null };
  const mock = createMetaInboxMock(endpoint), crypto = createMetaInboxCrypto({ ...keys, ...options });
  const reopen = () => createMetaInboxRepository({ database: mock.db, scope, crypto });
  const repository = reopen();
  const service = createMetaInboxService({ repository, scope, authentication: { secret, version: 'auth1' }, mode: 'isolated' });
  async function receive(value, receivedAt = mock.time()) {
    const rawBody = Buffer.from(JSON.stringify(envelope(value))), signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    return service.acceptRaw({ rawBody, signature, receivedAt });
  }
  return { ...mock, crypto, repository, reopen, service, receive };
}
const processor = createMetaInboxDispatcher();
const processNext = async (s, effect = processor, repo = s.repository) => repo.process(await repo.claim({ owner: 'worker' }), effect);
const fixtureTarget = (s, extra = {}) => s.seed('whatsAppConversationMessage', { id: 1, direction: 'OUTBOUND', deliveryStatus: 'PROCESSING', attempts: 1,
  idempotencyKey: 'operation', providerMessageId: null, failureCode: null, ...extra });
test('signed batch stores receipt + all items + encrypted native events atomically', async () => {
  const s = setup(), receipt = await s.receive({ ...incoming(), ...callback() });
  assert.equal(receipt.accepted, true); assert.equal(receipt.itemCount, 2); assert.equal(receipt.newCount, 2);
  assert.equal(s.rows('metaWebhookReceipt').length, 1); assert.equal(s.rows('metaWebhookReceiptItem').length, 2);
  const rows = s.rows('metaWebhookEvent'); assert.equal(rows[0].nativeMessageId, 'wamid.inbound'); assert.equal(rows[1].nativeMessageId, 'wamid.outbound');
  const stored = JSON.stringify([s.rows('metaWebhookReceipt'), rows, s.rows('metaWebhookReceiptItem')], (key, value) => typeof value === 'bigint' ? String(value) : value);
  assert.ok(!stored.includes(sender)); assert.ok(!stored.includes(secret)); assert.ok(!stored.includes('STOP'));
});
test('invalid signature, wrong account or malformed later item never stores any part', async () => {
  const s = setup(), rawBody = Buffer.from(JSON.stringify(envelope(incoming())));
  await assert.rejects(s.service.acceptRaw({ rawBody, signature: 'sha256=' + '0'.repeat(64), receivedAt: s.time() }), { code: 'META_INBOX_INVALID_SIGNATURE' });
  await assert.rejects(s.receive({ statuses: [{ status: 'read' }], ...incoming() }), { code: 'META_INBOX_INVALID_PAYLOAD' });
  const wrong = envelope(incoming()); wrong.entry[0].id = '9999'; const raw = Buffer.from(JSON.stringify(wrong));
  await assert.rejects(s.service.acceptRaw({ rawBody: raw, signature: 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'), receivedAt: s.time() }), { code: 'META_INBOX_ACCOUNT_MISMATCH' });
  assert.equal(s.rows('metaWebhookReceipt').length, 0); assert.equal(s.rows('metaWebhookEvent').length, 0);
});
test('mid-manifest storage error rolls back every event/receipt and exposes no private detail', async () => {
  const s = setup(); s.failCreate('metaWebhookReceiptItem', 2);
  await assert.rejects(s.receive({ ...incoming(), ...callback() }), e => e.code === 'META_INBOX_STORAGE_FAILED' && !e.message.includes('PRIVATE'));
  for (const n of ['metaWebhookReceipt', 'metaWebhookReceiptItem', 'metaWebhookEvent']) assert.equal(s.rows(n).length, 0);
});
test('commit failure is not an acceptance receipt; retry has no partial batch', async () => {
  const s = setup(); s.failCommit(); await assert.rejects(s.receive(incoming()), { code: 'META_INBOX_STORAGE_FAILED' });
  assert.equal(s.rows('metaWebhookEvent').length, 0); assert.equal((await s.receive(incoming())).newCount, 1);
});
test('simultaneous duplicates and retransmitted batches keep one event but preserve all occurrences', async () => {
  const s = setup(); await Promise.all(Array.from({ length: 6 }, () => s.receive(incoming())));
  assert.equal(s.rows('metaWebhookEvent').length, 1); assert.equal(s.rows('metaWebhookEvent')[0].receiptCount, 6n);
  assert.equal(s.rows('metaWebhookReceipt').length, 6); assert.equal(s.rows('metaWebhookReceiptItem').length, 6);
});
test('duplicate twice inside a batch and changed batch grouping cannot produce a second effect', async () => {
  const s = setup(), item = incoming().messages[0]; const result = await s.receive({ messages: [item, item] });
  assert.equal(result.newCount, 1); assert.equal(result.duplicateCount, 1);
  await s.receive({ ...callback(), messages: [item] }); assert.equal(s.rows('metaWebhookEvent').length, 2);
});
test('content conflict preserves original ciphertext and encrypted variant, never overwrites STOP', async () => {
  const s = setup(); await s.receive(incoming()); const before = structuredClone(s.rows('metaWebhookEvent')[0]);
  const r = await s.receive(incoming('OTHER')); assert.equal(r.conflictCount, 1);
  const event = s.rows('metaWebhookEvent')[0]; assert.equal(event.state, 'FAILED'); assert.equal(event.hasConflict, true);
  assert.deepEqual(event.normalizedPayloadCiphertext, before.normalizedPayloadCiphertext);
  assert.ok(s.rows('metaWebhookReceiptItem')[1].conflictPayloadCiphertext);
  assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('unknown status is durable for review; provider errors exclude sensitive data', async () => {
  const s = setup(); await s.receive({ ...callback({ status: 'future-status' }), errors: [{ code: 123, title: 'PRIVATE', error_data: { details: 'PRIVATE' } }] });
  assert.equal(s.rows('metaWebhookEvent')[0].state, 'FAILED');
  assert.equal((await processNext(s)).outcome, 'observed');
  const event = s.rows('metaWebhookEvent')[1];
  const payload = s.crypto.open(event.normalizedPayloadCiphertext, event.encryptionKeyVersion, [endpointId, 'event', event.id, Buffer.from(event.contentDigest).toString('hex')]);
  assert.deepEqual(payload, { code: '123' });
});
test('native message ID may produce different statuses without being collapsed', async () => {
  const s = setup(); for (const status of ['sent', 'delivered', 'read', 'failed']) await s.receive(callback({ status }));
  assert.equal(s.rows('metaWebhookEvent').length, 4);
});
test('uncorrelated callback survives repository reconstruction and exact wake, with no sender', async () => {
  const s = setup(); await s.receive(callback()); assert.equal((await processNext(s)).state, 'UNCORRELATED');
  fixtureTarget(s, { providerMessageId: 'wamid.outbound' });
  const repo = s.reopen(); assert.equal((await repo.wake({ nativeMessageId: 'wamid.other' })).count, 0);
  assert.equal((await repo.wake({ nativeMessageId: 'wamid.outbound' })).count, 1);
  assert.equal((await processNext(s, processor, repo)).state, 'PROCESSED');
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'DELIVERED');
});
test('callback before HTTP binding correlates by exact local key; late READ cannot be downgraded', async () => {
  const s = setup(); fixtureTarget(s); await s.receive(callback({ biz_opaque_callback_data: 'operation', status: 'read' }));
  await processNext(s); assert.equal(s.rows('whatsAppConversationMessage')[0].providerMessageId, 'wamid.outbound');
  await s.receive(callback({ status: 'sent' })); assert.equal((await processNext(s)).state, 'IGNORED');
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'READ');
});
test('lost response without a common key remains uncorrelated, never matched by number or time', async () => {
  const s = setup(); fixtureTarget(s); await s.receive(callback());
  assert.equal((await processNext(s)).state, 'UNCORRELATED');
  assert.equal(s.rows('whatsAppConversationMessage')[0].providerMessageId, null);
});
test('contradictory or ambiguous business identifiers are failed without mutation', async () => {
  const s = setup(); fixtureTarget(s, { providerMessageId: 'wamid.different' });
  await s.receive(callback({ biz_opaque_callback_data: 'operation' })); assert.equal((await processNext(s)).state, 'FAILED');
  assert.equal(s.rows('whatsAppConversationMessage')[0].providerMessageId, 'wamid.different');
  const other = setup(); fixtureTarget(other, { providerMessageId: 'wamid.outbound' });
  other.seed('whatsAppDelivery', { id: 2, providerMessageId: 'wamid.outbound' }); await other.receive(callback());
  assert.equal((await processNext(other)).state, 'FAILED');
});
test('two workers have one owner; expired lease is fenced after restart', async () => {
  const s = setup(); await s.receive(callback());
  const leases = await Promise.all([s.repository.claim({ owner: 'a', leaseMs: 1000 }), s.repository.claim({ owner: 'b', leaseMs: 1000 })]);
  assert.equal(leases.filter(Boolean).length, 1); const old = leases.find(Boolean); s.advance(1001);
  const repo = s.reopen(), fresh = await repo.claim({ owner: 'c' }); assert.equal(fresh.generation, old.generation + 1n);
  await assert.rejects(repo.process(old, processor), { code: 'META_INBOX_STALE_LEASE' });
  assert.equal((await repo.process(fresh, processor)).state, 'UNCORRELATED');
});
test('transactional effect and inbox mark roll back together after simulated process interruption', async () => {
  const s = setup(); fixtureTarget(s, { providerMessageId: 'wamid.outbound' }); await s.receive(callback());
  const lease = await s.repository.claim({ owner: 'a' });
  const interrupted = async (...args) => { await processor(...args); throw new Error('PRIVATE_CRASH'); };
  assert.equal((await s.repository.process(lease, interrupted)).state, 'RETRY_WAIT');
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'PROCESSING');
  s.advance(3000); assert.equal((await processNext(s, processor, s.reopen())).state, 'PROCESSED');
});
test('lease expiration during an effect rolls back business writes, not just inbox marking', async () => {
  const s = setup(); fixtureTarget(s, { providerMessageId: 'wamid.outbound' }); await s.receive(callback());
  const lease = await s.repository.claim({ owner: 'a', leaseMs: 1000 });
  await assert.rejects(s.repository.process(lease, async (...args) => { const result = await processor(...args); s.advance(1001); return result; }), { code: 'META_INBOX_STALE_LEASE' });
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'PROCESSING');
});
test('pending STOP blocks reservation without changing attempts or calling a mock submitter', async () => {
  const s = setup(); await s.receive(incoming()); let calls = 0;
  const result = await s.repository.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async () => { calls++; } });
  assert.equal(result.blocked, true); assert.equal(calls, 0); assert.equal((await s.repository.inspectBarrier(sender)).dispatchAuthorized, false);
});
test('STOP acceptance wins the race against a simulated send boundary', async () => {
  const s = setup(); let sends = 0;
  const stop = s.receive(incoming());
  const send = s.repository.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async () => { sends++; } });
  await stop; assert.equal((await send).blocked, true); assert.equal(sends, 0);
});
test('already crossed simulated boundary cannot be retroactively recalled by later STOP', async () => {
  const s = setup(); const trace = []; let release, started;
  const ready = new Promise(r => { started = r; });
  const send = s.repository.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async () => {
    trace.push('SUBMITTED'); started(); await new Promise(r => { release = r; }); return { simulated: true };
  } });
  await ready; const stop = s.receive(incoming()); release(); await send; await stop;
  assert.deepEqual(trace, ['SUBMITTED']); assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('processed STOP continues to block via business authorization, not only the inbox gate', async () => {
  const s = setup(); s.seed('simulationConsent', { id: 1, enabled: true }); await s.receive(incoming());
  const adapter = createMetaInboxDispatcher({ inboundTransaction: async (tx, message) => {
    assert.equal(message.text.body, 'STOP'); await tx.simulationConsent.updateMany({ where: { id: 1 }, data: { enabled: false } });
    return { ignored: false, duplicate: false };
  } });
  await processNext(s, adapter); let sends = 0;
  const result = await s.repository.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async tx => {
    if (!(await tx.simulationConsent.findFirst({ where: { id: 1 } })).enabled) return { blocked: true, reason: 'CONSENT_WITHDRAWN' };
    sends++;
  } });
  assert.equal(result.blocked, true); assert.equal(sends, 0);
});
test('missing production inbound transaction adapter is fail-closed and leaves STOP blocking', async () => {
  const s = setup(); await s.receive(incoming()); assert.equal((await processNext(s)).state, 'FAILED');
  assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('ordered stream cannot overtake an earlier inbound in retry', async () => {
  const s = setup(); await s.receive(incoming('A', 'wamid.a')); await s.receive(incoming('STOP', 'wamid.b'));
  const lease = await s.repository.claim({ owner: 'a' }); await s.repository.process(lease, async () => { throw new Error('retry'); });
  assert.equal(await s.repository.claim({ owner: 'b' }), null);
});
test('persistent mock claim permits one simulated send across concurrent callers and reconstruction', async () => {
  const s = setup(); s.seed('simulationDelivery', { id: 1, state: 'QUEUED', attempts: 0 }); let sends = 0;
  const send = repo => repo.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async tx => {
    const claim = await tx.simulationDelivery.updateMany({ where: { id: 1, state: 'QUEUED' }, data: { state: 'UNCERTAIN', attempts: { increment: 1 } } });
    if (!claim.count) return { blocked: true }; sends++; return { simulated: true };
  } });
  await Promise.all([send(s.repository), send(s.reopen())]); await send(s.reopen());
  assert.equal(sends, 1); assert.equal(s.rows('simulationDelivery')[0].attempts, 1);
});
test('simulation dispatch never automatically replays an ambiguous commit', async () => {
  const s = setup(); let sends = 0; s.failCommit('P2034');
  await assert.rejects(s.repository.simulateDispatch({ sender, mode: 'isolated', claimAndSubmitMock: async () => { sends++; return {}; } }), { code: 'META_INBOX_STORAGE_FAILED' });
  assert.equal(sends, 1); // Does NOT claim that a fresh caller could safely resend.
});
test('a future timestamp cannot open the service window just because its event waited', async () => {
  const s = setup(), value = incoming('Hello'); value.messages[0].timestamp = String(Math.floor(+s.time() / 1000) + 60);
  await s.receive(value); s.advance(120000); let observed;
  assert.equal((await s.receive(value)).duplicateCount, 1); // Receipt-time validity never overwrites the first payload.
  await processNext(s, createMetaInboxDispatcher({ inboundTransaction: async (tx, message, context) => {
    observed = { message, context }; return { ignored: false, duplicate: false };
  } }));
  assert.equal(observed.message.timestamp, undefined); assert.equal(+observed.context.firstReceivedAt, +s.time() - 120000);
  assert.equal(+observed.context.processedAt, +s.time());
});
test('payload purge retains tombstone and unresolved STOP remains a barrier', async () => {
  const s = setup(); await s.receive(incoming()); s.advance(31 * 86400000);
  const result = await s.repository.expirePayloads(); assert.equal(result.expiredPayloads, 1);
  const event = s.rows('metaWebhookEvent')[0]; assert.equal(event.state, 'EXPIRED'); assert.equal(event.normalizedPayloadCiphertext, null);
  assert.equal((await s.repository.inspectBarrier(sender)).blocked, true); assert.equal((await s.receive(incoming())).duplicateCount, 1);
});
test('key rotation deduplicates against the old version without inventing content conflicts', async () => {
  const s = setup(); await s.receive(incoming()); s.rows('metaWebhookEndpoint')[0].lookupKeyVersion = 'l2';
  const crypto = createMetaInboxCrypto({ ...keys, lookupKeys: { l1: Buffer.alloc(32, 1), l2: Buffer.alloc(32, 4) }, currentLookupVersion: 'l2' });
  const repo = createMetaInboxRepository({ database: s.db, scope, crypto });
  const service = createMetaInboxService({ repository: repo, scope, authentication: { secret, version: 'auth1' }, mode: 'isolated' });
  const rawBody = Buffer.from(JSON.stringify(envelope(incoming()))), signature = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  assert.equal((await service.acceptRaw({ rawBody, signature, receivedAt: s.time() })).duplicateCount, 1);
  assert.equal(s.rows('metaWebhookEvent').length, 1); assert.equal(s.rows('metaWebhookEvent')[0].hasConflict, false);
});
test('missing historical lookup key and mismatching scope/config fail closed', async () => {
  const s = setup(); await s.receive(callback()); s.rows('metaWebhookEndpoint')[0].lookupKeyVersion = 'l2';
  const crypto = createMetaInboxCrypto({ ...keys, lookupKeys: { l2: Buffer.alloc(32, 4) }, currentLookupVersion: 'l2' });
  const repo = createMetaInboxRepository({ database: s.db, scope, crypto });
  await assert.rejects(repo.claim({ owner: 'a' }), { code: 'META_INBOX_MISSING_LOOKUP_KEY' });
  s.rows('metaWebhookEndpoint')[0].wabaId = '9999'; await assert.rejects(s.repository.claim({ owner: 'a' }), { code: 'META_INBOX_SCOPE_MISMATCH' });
});
test('cipher authenticates endpoint, object, digest and key version', () => {
  const s = setup(), context = [endpointId, 'event', randomUUID(), 'digest']; const sealed = s.crypto.seal({ text: 'PRIVATE' }, context);
  assert.deepEqual(s.crypto.open(sealed.ciphertext, sealed.keyVersion, context), { text: 'PRIVATE' });
  assert.throws(() => s.crypto.open(sealed.ciphertext, sealed.keyVersion, [randomUUID(), ...context.slice(1)]), { code: 'META_INBOX_DECRYPTION_FAILED' });
  sealed.ciphertext[sealed.ciphertext.length - 1] ^= 1;
  assert.throws(() => s.crypto.open(sealed.ciphertext, sealed.keyVersion, context), { code: 'META_INBOX_DECRYPTION_FAILED' });
});
test('real ingress and real dispatch are unavailable regardless of synthetic endpoint flags', async () => {
  const s = setup(); const live = createMetaInboxService({ repository: s.repository, scope, authentication: { secret, version: 'auth1' }, mode: 'live' });
  await assert.rejects(live.acceptRaw({}), { code: 'META_INBOX_NOT_ACTIVATED' });
  await assert.rejects(s.repository.simulateDispatch({ mode: 'live', sender, claimAndSubmitMock: async () => {} }), { code: 'META_INBOX_REAL_DISPATCH_FORBIDDEN' });
});
test('storage serialization abort can retry ingestion without duplicating effects', async () => {
  const s = setup(); s.failBegin('P2034');
  assert.equal((await s.receive(incoming())).newCount, 1); assert.equal(s.rows('metaWebhookEvent').length, 1);
});
test('changing stream-key version with an open STOP is refused, not treated as a different sender', async () => {
  const s = setup(); await s.receive(incoming()); s.rows('metaWebhookEndpoint')[0].streamKeyVersion = 's2';
  const crypto = createMetaInboxCrypto({ ...keys, streamKey: Buffer.alloc(32, 5), streamKeyVersion: 's2' });
  const repo = createMetaInboxRepository({ database: s.db, scope, crypto });
  await assert.rejects(repo.inspectBarrier(sender), { code: 'META_INBOX_OPEN_STREAM_VERSION_CONFLICT' });
});
test('disabled endpoint acceptance/processing has no side effect', async () => {
  const s = setup(); s.rows('metaWebhookEndpoint')[0].inboxEnabled = false;
  await assert.rejects(s.receive(incoming()), { code: 'META_INBOX_ACCEPTANCE_DISABLED' });
  assert.equal(s.rows('metaWebhookEvent').length, 0);
  s.rows('metaWebhookEndpoint')[0].inboxEnabled = true; await s.receive(incoming());
  s.rows('metaWebhookEndpoint')[0].processingEnabled = false;
  await assert.rejects(s.repository.claim({ owner: 'a' }), { code: 'META_INBOX_PROCESSING_DISABLED' });
  assert.equal(s.rows('metaWebhookEvent')[0].state, 'READY');
});
test('corrupted ciphertext is failed before any business effect and remains STOP-blocking', async () => {
  const s = setup(); await s.receive(incoming()); s.rows('metaWebhookEvent')[0].normalizedPayloadCiphertext[35] ^= 1;
  let calls = 0;
  const outcome = await processNext(s, async () => { calls++; return { outcome: 'applied' }; });
  assert.equal(outcome.state, 'FAILED'); assert.equal(calls, 0); assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('conflict after a committed effect preserves historical outcome but blocks further dispatch for review', async () => {
  const s = setup(); await s.receive(incoming('Hi'));
  await processNext(s, createMetaInboxDispatcher({ inboundTransaction: async () => ({ ignored: false, duplicate: false }) }));
  await s.receive(incoming('STOP'));
  assert.equal(s.rows('metaWebhookEvent')[0].state, 'PROCESSED'); assert.equal(s.rows('metaWebhookEvent')[0].effectOutcome, 'APPLIED');
  assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('ciphertext variant expiry does not erase its conflict disposition or the original tombstone', async () => {
  const s = setup(); await s.receive(incoming()); await s.receive(incoming('OTHER')); s.advance(31 * 86400000);
  const result = await s.repository.expirePayloads(); assert.equal(result.expiredVariants, 1);
  const variant = s.rows('metaWebhookReceiptItem')[1]; assert.equal(variant.disposition, 'CONFLICT');
  assert.equal(variant.conflictPayloadCiphertext, null); assert.ok(variant.payloadPurgedAt);
  assert.equal(s.rows('metaWebhookEvent')[0].hasConflict, true);
});
test('an unresolved control-like unknown inbound blocks dispatch; another known sender is independent', async () => {
  const s = setup(); await s.receive(incoming());
  assert.equal((await s.repository.inspectBarrier('15555550124')).blocked, false);
  const unknown = incoming(); unknown.messages[0].id = 'wamid.future'; unknown.messages[0].type = 'unknown-control';
  await s.receive(unknown); assert.equal((await s.repository.inspectBarrier(sender)).blocked, true);
});
test('a known CANCELLED delivery cannot be revived by a status callback', async () => {
  const s = setup(); fixtureTarget(s, { deliveryStatus: 'CANCELLED', providerMessageId: 'wamid.outbound' });
  await s.receive(callback()); assert.equal((await processNext(s)).state, 'IGNORED');
  assert.equal(s.rows('whatsAppConversationMessage')[0].deliveryStatus, 'CANCELLED');
});
test('a long blocked stream cannot starve an eligible different stream beyond the first claim page', async () => {
  const s = setup(); await s.receive(incoming('A', 'wamid.first'));
  const first = s.rows('metaWebhookEvent')[0]; first.state = 'FAILED';
  const messages = Array.from({ length: 101 }, (_, n) => incoming('A', 'wamid.blocked.' + n).messages[0]);
  messages.push({ ...incoming('B', 'wamid.eligible').messages[0], from: '15555550124' });
  await s.receive({ messages }); const lease = await s.repository.claim({ owner: 'a' });
  assert.equal((await s.repository.lookup(lease.id)).nativeMessageId, 'wamid.eligible');
});
