// Unwired persistence primitives. No Prisma singleton, HTTP transport or worker here.
const { randomUUID, createHash } = require('node:crypto');
const { verifyGupshupWebhook } = require('./gupshupWebhookVerifier');
const { canonicalId } = require('./gupshupTransport');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const ascii = (value, max = 512) => typeof value === 'string' && /^[\x21-\x7e]+$/.test(value) && value.length <= max;
const hash = value => createHash('sha256').update(value).digest();
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
function json(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return '[' + value.map(json).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + json(value[k])).join(',') + '}';
}
const kinds = { conversation: ['whatsAppConversationMessage', 'conversationMessageId'], notification: ['whatsAppDelivery', 'notificationDeliveryId'], followUp: ['whatsAppProspectFollowUp', 'followUpId'] };
const clearLease = { leaseToken: null, leaseOwner: null, leaseExpiresAt: null };

function createGupshupDurableStore({ database, scope, codec } = {}) {
  if (!database?.$transaction || !scope || !uuid(scope.applicationId) || scope.provider !== 'gupshup'
      || !['test', 'staging', 'production'].includes(scope.environment)
      || typeof scope.applicationKey !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.applicationKey)) fail('GUPSHUP_INVALID_SCOPE');
  // Capture immutable primitives; a caller cannot later mutate the repository scope.
  const { applicationId, applicationKey, environment } = scope;
  async function app(tx) {
    const row = await tx.providerApplication.findFirst({ where: { id: applicationId, provider: 'gupshup', environment, applicationKey } });
    if (!row || row.apiFamily !== 'messaging-wa-v1' || row.webhookVersion !== 2) fail('GUPSHUP_SCOPE_NOT_FOUND');
    return row;
  }
  async function transaction(work) {
    // Only storage operations may run inside work: never network/business callbacks.
    for (let retry = 0; ; retry++) {
      try { return await database.$transaction(async tx => { await app(tx); return work(tx); }, { isolationLevel: 'Serializable' }); }
      catch (e) { if (retry >= 2 || !['P2034', 'P2002'].includes(e.code)) throw e; }
    }
  }
  async function now(tx) {
    const rows = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
    if (!(rows[0]?.now instanceof Date) || !Number.isFinite(rows[0].now.getTime())) fail('GUPSHUP_INVALID_DATABASE_CLOCK');
    return rows[0].now;
  }
  async function inspect(id) {
    if (!uuid(id)) fail('GUPSHUP_INVALID_ID');
    return transaction(tx => tx.providerWebhookEvent.findFirst({ where: { applicationId, id } }));
  }
  async function receiveRealWebhook() {
    // No trusted=true/string-header bypass. Authentication is still unconfirmed.
    verifyGupshupWebhook();
  }
  async function receiveSimulated(event) {
    // Explicitly separate synthetic fixtures from a real authenticated ingress.
    if (environment !== 'test' || process.env.NODE_ENV === 'production') fail('GUPSHUP_SIMULATION_REQUIRED');
    if (!codec?.seal) fail('GUPSHUP_ENCRYPTION_REQUIRED');
    if (!event || event.provider !== 'gupshup' || event.applicationKey !== applicationKey
      || !['inbound', 'status', 'transport', 'unsupported'].includes(event.kind)) fail('GUPSHUP_INVALID_EVENT');
    const gs = event.externalIds?.gupshup ?? null, wa = event.externalIds?.whatsapp ?? null;
    if ((gs !== null && !ascii(gs)) || (wa !== null && !ascii(wa))) fail('GUPSHUP_INVALID_EXTERNAL_ID');
    const status = event.kind === 'status' ? event.data?.status : null;
    if (event.kind === 'status' && !['sent', 'delivered', 'read', 'failed'].includes(status)) fail('GUPSHUP_INVALID_EVENT');
    const occurredAt = event.occurredAt == null ? null : new Date(event.occurredAt);
    if (occurredAt && !Number.isFinite(occurredAt.getTime())) fail('GUPSHUP_INVALID_EVENT');
    // Conservative v1: inbound ID independent of arrival time. Status identity excludes body.
    // Unsupported events without an identity use a content-addressed quarantine tombstone.
    const content = json({ kind: event.kind, externalIds: { gupshup: gs, whatsapp: wa }, data: event.data ?? null,
      sourcePayload: event.sourcePayload ?? null });
    if (Buffer.byteLength(content) > 1024 * 1024) fail('GUPSHUP_EVENT_TOO_LARGE');
    const payloadDigest = hash(content);
    const identity = event.kind === 'inbound' && wa ? ['inbound', wa]
      : ['status', 'transport'].includes(event.kind) && (gs || wa)
        ? [event.kind, gs, wa, status, occurredAt?.toISOString() ?? null] : ['unidentified', payloadDigest.toString('hex')];
    const dedupKey = hash(json(identity));
    const encrypted = await codec.seal(Buffer.from(content));
    if (!Buffer.isBuffer(encrypted?.ciphertext) || !encrypted.ciphertext.length || !ascii(encrypted.keyReference, 200)) fail('GUPSHUP_ENCRYPTION_FAILED');
    return transaction(async tx => {
      const application = await app(tx);
      if (application.inboundEnabled || application.outboundEnabled) fail('GUPSHUP_SIMULATION_SCOPE_ENABLED');
      const time = await now(tx);
      const where = { applicationId, dedupVersion: 1, dedupKey };
      const old = await tx.providerWebhookEvent.findFirst({ where });
      if (old) {
        const conflict = !same(old.payloadDigest, payloadDigest);
        await tx.providerWebhookEvent.updateMany({ where: { applicationId, id: old.id }, data: {
          receiptCount: { increment: 1 }, lastReceivedAt: time,
          ...(conflict ? { state: 'QUARANTINED', resolutionCode: 'DUPLICATE_CONTENT_CONFLICT', quarantinedAt: time, ...clearLease } : {}),
        } });
        if (conflict) await tx.providerReconciliationAudit.create({ data: { id: randomUUID(), applicationId, eventId: old.id,
          action: 'REJECT_CONFLICT', reasonCode: 'DUPLICATE_CONTENT_CONFLICT', evidenceReference: `sha256:${payloadDigest.toString('hex')}`, createdAt: time } });
        return { id: old.id, duplicate: true, conflict };
      }
      const quarantined = event.kind === 'unsupported' || (event.kind === 'inbound' && !wa) || (!gs && !wa);
      const row = await tx.providerWebhookEvent.create({ data: {
        id: randomUUID(), applicationId, eventKind: event.kind, dedupVersion: 1, dedupKey, payloadDigest,
        externalGupshupId: gs, externalWhatsappId: wa, normalizedStatus: status, occurredAt,
        occurredAtSource: occurredAt ? event.occurredAtSource ?? null : null,
        firstReceivedAt: time, lastReceivedAt: time, receiptCount: 1,
        payloadCiphertext: encrypted.ciphertext, encryptionKeyReference: encrypted.keyReference,
        payloadExpiresAt: new Date(+time + 30 * 86400000), tombstoneExpiresAt: new Date(+time + 90 * 86400000),
        authenticationMethod: 'simulation', credentialVersion: 'simulation-v1',
        state: quarantined ? 'QUARANTINED' : 'RECEIVED', nextProcessAt: time,
        ...(quarantined ? { quarantinedAt: time, resolutionCode: 'UNSUPPORTED_OR_NO_ID' } : {}),
      } });
      return { id: row.id, duplicate: false, conflict: false };
    });
  }
  async function target(tx, delivery) {
    const config = kinds[delivery.deliveryKind];
    if (!config) fail('GUPSHUP_INVALID_TARGET');
    const row = await tx[config[0]].findFirst({ where: { id: delivery[config[1]] } });
    if (!row || (delivery.deliveryKind === 'conversation' && row.direction !== 'OUTBOUND')) fail('GUPSHUP_INVALID_TARGET');
    return row;
  }
  async function prepareAttempt({ deliveryKind, deliveryId, attemptNumber, operationKey, payloadDigest }) {
    if (!kinds[deliveryKind] || !Number.isSafeInteger(deliveryId) || deliveryId < 1
      || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || !ascii(operationKey, 128)
      || !Buffer.isBuffer(payloadDigest) || payloadDigest.length !== 32) fail('GUPSHUP_INVALID_ATTEMPT');
    return transaction(async tx => {
      const time = await now(tx), field = kinds[deliveryKind][1];
      // Unique target is deliberately global: never attach the same NVA delivery to two apps.
      let delivery = await tx.providerDelivery.findFirst({ where: { [field]: deliveryId } });
      if (delivery && delivery.applicationId !== applicationId) fail('GUPSHUP_TARGET_SCOPE_CONFLICT');
      const proposed = delivery || { deliveryKind, [field]: deliveryId };
      const nva = await target(tx, proposed);
      const processing = deliveryKind === 'conversation' ? nva.deliveryStatus : nva.status;
      if (nva.attempts !== attemptNumber || processing !== 'PROCESSING') fail('GUPSHUP_NVA_CLAIM_REQUIRED');
      if (!delivery) delivery = await tx.providerDelivery.create({ data: { id: randomUUID(), applicationId, deliveryKind, [field]: deliveryId } });
      const old = await tx.providerSendAttempt.findFirst({ where: { applicationId, operationKey } });
      if (old) {
        if (old.deliveryRefId !== delivery.id || old.attemptNumber !== attemptNumber || !same(old.payloadDigest, payloadDigest)) fail('GUPSHUP_OPERATION_CONFLICT');
        return old; // Returning existing state does not authorize re-dispatch.
      }
      // Any unresolved dispatch blocks a later attempt, even if its caller has a newer claim.
      const unsafe = await tx.providerSendAttempt.findFirst({ where: { applicationId, deliveryRefId: delivery.id,
        state: { in: ['PREPARED', 'DISPATCHING', 'UNCERTAIN', 'ACCEPTED'] } } });
      if (unsafe) fail('GUPSHUP_UNRESOLVED_ATTEMPT');
      const row = await tx.providerSendAttempt.create({ data: { id: randomUUID(), applicationId, deliveryRefId: delivery.id,
        attemptNumber, operationKey, payloadDigest, state: 'PREPARED', preparedAt: time } });
      await tx.providerDelivery.updateMany({ where: { applicationId, id: delivery.id }, data: { activeAttemptId: row.id } });
      return row;
    });
  }
  async function beginDispatch(attemptId) {
    if (!uuid(attemptId)) fail('GUPSHUP_INVALID_ID');
    return transaction(async tx => {
      const attempt = await tx.providerSendAttempt.findFirst({ where: { applicationId, id: attemptId } });
      if (!attempt) fail('GUPSHUP_UNKNOWN_ATTEMPT');
      const delivery = await tx.providerDelivery.findFirst({ where: { applicationId, id: attempt.deliveryRefId, activeAttemptId: attemptId } });
      if (!delivery) fail('GUPSHUP_INACTIVE_ATTEMPT');
      const nva = await target(tx, delivery);
      if (nva.attempts !== attempt.attemptNumber || (delivery.deliveryKind === 'conversation' ? nva.deliveryStatus : nva.status) !== 'PROCESSING') fail('GUPSHUP_NVA_CLAIM_REQUIRED');
      const time = await now(tx), token = randomUUID();
      const changed = await tx.providerSendAttempt.updateMany({ where: { applicationId, id: attemptId, state: 'PREPARED' },
        data: { state: 'DISPATCHING', dispatchToken: token, dispatchStartedAt: time } });
      if (changed.count !== 1) fail('GUPSHUP_DISPATCH_ALREADY_STARTED');
      return { attemptId, dispatchToken: token }; // One-time grant; no transport is wired.
    });
  }
  async function addAlias(tx, attemptId, aliasType, externalId, time, eventId = null) {
    const where = { applicationId, aliasType, externalId };
    const old = await tx.providerMessageAlias.findFirst({ where });
    if (old && old.attemptId !== attemptId) fail('GUPSHUP_ALIAS_CONFLICT');
    if (!old) await tx.providerMessageAlias.create({ data: { id: randomUUID(), ...where, attemptId, learnedFromEventId: eventId, learnedAt: time } });
    await tx.providerWebhookEvent.updateMany({ where: { applicationId, state: 'WAITING_CORRELATION',
      [aliasType === 'gupshup_submission' ? 'externalGupshupId' : 'externalWhatsappId']: externalId },
    data: { state: 'RECEIVED', nextProcessAt: time } });
  }
  async function recordResponse({ attemptId, dispatchToken, submissionId }) {
    if (!uuid(attemptId) || !uuid(dispatchToken) || !ascii(submissionId)) fail('GUPSHUP_INVALID_RESPONSE');
    return transaction(async tx => {
      const time = await now(tx);
      const attempt = await tx.providerSendAttempt.findFirst({ where: { applicationId, id: attemptId, dispatchToken } });
      if (!attempt || !['DISPATCHING', 'UNCERTAIN', 'ACCEPTED'].includes(attempt.state)) fail('GUPSHUP_RESPONSE_REFUSED');
      if (attempt.submissionId && attempt.submissionId !== submissionId) fail('GUPSHUP_ALIAS_CONFLICT');
      const canonical = canonicalId(applicationKey, submissionId);
      await addAlias(tx, attemptId, 'gupshup_submission', submissionId, time);
      await tx.providerSendAttempt.updateMany({ where: { applicationId, id: attemptId, dispatchToken }, data: {
        state: 'ACCEPTED', submissionId, canonicalId: canonical, responseReceivedAt: time, acceptedAt: time,
      } });
      await tx.providerWebhookEvent.updateMany({ where: { applicationId, state: 'WAITING_CORRELATION', externalGupshupId: submissionId },
        data: { state: 'RECEIVED', nextProcessAt: time } });
      return { providerMessageId: canonical };
    });
  }
  async function markUncertain({ attemptId, dispatchToken }) {
    if (!uuid(attemptId) || !uuid(dispatchToken)) fail('GUPSHUP_INVALID_ID');
    return transaction(async tx => tx.providerSendAttempt.updateMany({ where: { applicationId, id: attemptId, dispatchToken, state: 'DISPATCHING' },
      data: { state: 'UNCERTAIN', uncertainAt: await now(tx), errorCode: 'DELIVERY_UNCERTAIN' } }));
  }
  async function claim({ owner, leaseMs = 30000 } = {}) {
    if (!ascii(owner, 64) || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) fail('GUPSHUP_INVALID_LEASE');
    return transaction(async tx => {
      const time = await now(tx);
      const row = await tx.providerWebhookEvent.findFirst({ where: { applicationId,
        payloadExpiresAt: { gt: time }, payloadCiphertext: { not: null },
        OR: [{ state: { in: ['RECEIVED', 'RETRY_WAIT', 'WAITING_BINDING'] }, nextProcessAt: { lte: time } },
          { state: 'PROCESSING', leaseExpiresAt: { lte: time } }] }, orderBy: [{ firstReceivedAt: 'asc' }, { id: 'asc' }] });
      if (!row) return null;
      const token = randomUUID();
      const changed = await tx.providerWebhookEvent.updateMany({ where: { applicationId, id: row.id, state: row.state,
        leaseGeneration: row.leaseGeneration }, data: { state: 'PROCESSING', leaseToken: token, leaseOwner: owner,
        leaseGeneration: { increment: 1n }, processAttempts: { increment: 1 }, leaseExpiresAt: new Date(+time + leaseMs) } });
      if (changed.count !== 1) return null;
      return { id: row.id, token, generation: BigInt(row.leaseGeneration) + 1n };
    });
  }
  async function leased(tx, lease, time) {
    if (!uuid(lease?.id) || !uuid(lease.token) || typeof lease.generation !== 'bigint') fail('GUPSHUP_INVALID_LEASE');
    const row = await tx.providerWebhookEvent.findFirst({ where: { applicationId, id: lease.id, state: 'PROCESSING',
      leaseToken: lease.token, leaseGeneration: lease.generation, leaseExpiresAt: { gt: time } } });
    if (!row) fail('GUPSHUP_STALE_LEASE');
    return row;
  }
  async function transition(tx, row, lease, time, data) {
    const changed = await tx.providerWebhookEvent.updateMany({ where: { applicationId, id: row.id, state: 'PROCESSING',
      leaseToken: lease.token, leaseGeneration: lease.generation, leaseExpiresAt: { gt: time } }, data: { ...clearLease, ...data } });
    if (changed.count !== 1) fail('GUPSHUP_STALE_LEASE');
  }
  async function resolve(lease) {
    return transaction(async tx => {
      const time = await now(tx), event = await leased(tx, lease, time);
      if (!['status', 'transport'].includes(event.eventKind)) {
        await transition(tx, event, lease, time, { state: 'QUARANTINED', quarantinedAt: time, resolutionCode: 'NO_HANDLER_ATTACHED' });
        return { state: 'QUARANTINED' };
      }
      const pairs = [['gupshup_submission', event.externalGupshupId], ['whatsapp_message', event.externalWhatsappId]].filter(([, id]) => id);
      const found = [];
      for (const [aliasType, externalId] of pairs) {
        const alias = await tx.providerMessageAlias.findFirst({ where: { applicationId, aliasType, externalId } });
        if (alias) found.push(alias.attemptId);
      }
      const quarantine = async () => {
        await transition(tx, event, lease, time, { state: 'QUARANTINED', quarantinedAt: time, resolutionCode: 'ALIAS_CONFLICT' });
        await tx.providerReconciliationAudit.create({ data: { id: randomUUID(), applicationId, eventId: event.id,
          action: 'REJECT_CONFLICT', reasonCode: 'ALIAS_CONFLICT', createdAt: time } });
        return { state: 'QUARANTINED' };
      };
      if (new Set(found).size > 1) return quarantine();
      if (!found.length) {
        await transition(tx, event, lease, time, { state: 'WAITING_CORRELATION', resolutionCode: 'NO_COMMON_IDENTIFIER' });
        await tx.providerReconciliationAudit.create({ data: { id: randomUUID(), applicationId, eventId: event.id,
          action: 'KEEP_UNRESOLVED', reasonCode: 'NO_COMMON_IDENTIFIER', createdAt: time } });
        return { state: 'WAITING_CORRELATION' };
      }
      const attempt = await tx.providerSendAttempt.findFirst({ where: { applicationId, id: found[0] } });
      if (!attempt || (event.externalGupshupId && attempt.submissionId !== event.externalGupshupId)) return quarantine();
      for (const [type, id] of pairs) await addAlias(tx, attempt.id, type, id, time, event.id);
      const delivery = await tx.providerDelivery.findFirst({ where: { applicationId, id: attempt.deliveryRefId } });
      if (!delivery || delivery.activeAttemptId !== attempt.id) return quarantine();
      const nva = await target(tx, delivery);
      const status = delivery.deliveryKind === 'conversation' ? nva.deliveryStatus : nva.status;
      const ready = attempt.state === 'ACCEPTED' && attempt.canonicalId && nva.providerMessageId === attempt.canonicalId
        && nva.attempts === attempt.attemptNumber && status !== 'CANCELLED';
      // This repository cannot apply business effects. Retain even a ready callback until a future worker is authorized.
      await transition(tx, event, lease, time, { state: 'WAITING_BINDING', attemptId: attempt.id,
        nextProcessAt: new Date(+time + 60000), resolutionCode: ready ? 'READY_NO_WORKER_ATTACHED' : 'NVA_BINDING_NOT_CONFIRMED' });
      return { state: 'WAITING_BINDING', ready: Boolean(ready), deliveryKind: delivery.deliveryKind,
        deliveryId: delivery[kinds[delivery.deliveryKind][1]], attemptNumber: attempt.attemptNumber, providerMessageId: attempt.canonicalId };
    });
  }
  async function defer(lease) {
    // Retry storage processing only, never the HTTP send. Caller does not persist raw errors.
    return transaction(async tx => {
      const time = await now(tx), row = await leased(tx, lease, time);
      const terminal = row.processAttempts >= 10;
      await transition(tx, row, lease, time, terminal
        ? { state: 'QUARANTINED', quarantinedAt: time, resolutionCode: 'PROCESS_RETRY_LIMIT', lastErrorCode: 'HANDLER_FAILED' }
        : { state: 'RETRY_WAIT', nextProcessAt: new Date(+time + Math.min(3600000, 1000 * 2 ** row.processAttempts)), lastErrorCode: 'HANDLER_FAILED' });
      return { state: terminal ? 'QUARANTINED' : 'RETRY_WAIT' };
    });
  }
  async function recover({ dispatchBefore } = {}) {
    if (!(dispatchBefore instanceof Date) || !Number.isFinite(+dispatchBefore)) fail('GUPSHUP_INVALID_RECOVERY_CUTOFF');
    return transaction(async tx => {
      const time = await now(tx);
      if (dispatchBefore > time) fail('GUPSHUP_INVALID_RECOVERY_CUTOFF');
      const attempts = await tx.providerSendAttempt.updateMany({ where: { applicationId, state: 'DISPATCHING', dispatchStartedAt: { lte: dispatchBefore } },
        data: { state: 'UNCERTAIN', uncertainAt: time, errorCode: 'INTERRUPTED_DISPATCH' } });
      const expired = await tx.providerWebhookEvent.updateMany({ where: { applicationId, payloadExpiresAt: { lte: time },
        state: { in: ['RECEIVED', 'RETRY_WAIT', 'WAITING_BINDING', 'WAITING_CORRELATION', 'PROCESSING'] } },
        data: { state: 'EXPIRED', resolutionCode: 'PAYLOAD_RETENTION_EXPIRED', ...clearLease } });
      // No resets to PREPARED, no send callback; expired leases are reclaimed by claim().
      return { uncertainAttempts: attempts.count, expiredEvents: expired.count };
    });
  }
  return Object.freeze({ receiveRealWebhook, receiveSimulated, inspect, prepareAttempt, beginDispatch, recordResponse, markUncertain, claim, resolve, defer, recover });
}
module.exports = { createGupshupDurableStore };
