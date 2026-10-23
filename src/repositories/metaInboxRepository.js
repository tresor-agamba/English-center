// Unwired Prisma repository. Requires the four Meta delegates and dedicated SQL
// constraints/triggers. No import of an application database or transport.
const { randomUUID } = require('node:crypto');
const { fail } = require('../services/metaInboxProtocol');
const { lockRecipients } = require('../services/whatsappSubmissionCoordinator');
const clearLease = { leaseToken: null, leaseOwner: null, leaseExpiresAt: null };
const open = ['RECEIVED', 'READY', 'PROCESSING', 'UNCORRELATED', 'RETRY_WAIT', 'FAILED', 'EXPIRED'];
const same = (a, b) => a != null && b != null && Buffer.from(a).equals(Buffer.from(b));
const day = 86400000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function createMetaInboxRepository({ database, scope, crypto } = {}) {
  if (!database?.$transaction || !uuid(scope?.endpointId) || !['test', 'staging', 'production'].includes(scope.environment)
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(scope.applicationKey || '') || !/^\d{1,64}$/.test(scope.wabaId || '')
    || !/^\d{1,64}$/.test(scope.phoneNumberId || '') || !/^\d{1,64}$/.test(scope.metaAppId || '') || !crypto?.seal) fail('META_INBOX_INVALID_CONFIGURATION');
  const fixed = Object.freeze(Object.fromEntries(['endpointId', 'environment', 'applicationKey', 'wabaId', 'phoneNumberId', 'metaAppId'].map(k => [k, scope[k]])));
  const { endpointId } = fixed;
  async function atomic(work, retrySafe = true) {
    // Retry only transactional storage effects; no external I/O in work.
    for (let retry = 0; ; retry++) {
      try {
        return await database.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM meta_webhook_endpoints WHERE id = ${endpointId}::uuid FOR UPDATE`;
          const endpoint = await tx.metaWebhookEndpoint.findFirst({ where: { id: endpointId, environment: fixed.environment,
            applicationKey: fixed.applicationKey, wabaId: fixed.wabaId, phoneNumberId: fixed.phoneNumberId, metaAppId: fixed.metaAppId } });
          if (!endpoint || endpoint.disabledAt) fail('META_INBOX_SCOPE_MISMATCH');
          if (endpoint.identityVersion !== 1 || endpoint.normalizationVersion !== 1 || endpoint.lookupKeyVersion !== crypto.currentLookupVersion
            || endpoint.streamKeyVersion !== crypto.streamKeyVersion) fail('META_INBOX_KEY_CONFIGURATION_CHANGED');
          const missingKey = await tx.metaWebhookEvent.findFirst({ where: { endpointId, lookupKeyVersion: { notIn: crypto.lookupVersions } } });
          if (missingKey) fail('META_INBOX_MISSING_LOOKUP_KEY');
          const oldFlow = await tx.metaWebhookEvent.findFirst({ where: { endpointId, streamKey: { not: null },
            streamKeyVersion: { not: crypto.streamKeyVersion }, OR: [{ state: { in: open } }, { hasConflict: true }] } });
          if (oldFlow) fail('META_INBOX_OPEN_STREAM_VERSION_CONFLICT');
          const clock = (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0]?.now;
          if (!(clock instanceof Date) || !Number.isFinite(+clock)) fail('META_INBOX_INVALID_DATABASE_CLOCK');
          return work(tx, clock, endpoint);
        }, { isolationLevel: 'Serializable', timeout: 5000 });
      } catch (error) {
        const conflict = ['P2034', 'P2002'].includes(error?.code)
          || (error?.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code));
        if (retrySafe && retry < 2 && conflict) continue;
        if (/^META_INBOX_[A-Z_]+$/.test(error?.code || '')) fail(error.code);
        fail('META_INBOX_STORAGE_FAILED'); // Never expose SQL parameters/payloads.
      }
    }
  }
  async function lockStreams(tx, streams) {
    for (const key of [...new Set(streams.filter(Boolean).map(v => Buffer.from(v).toString('hex')))].sort()) {
      // Scope + digest derive one advisory key. Collisions serialize, never correlate.
      // The keyed stream digest already includes the endpoint. Lookup-key
      // rotation must NOT change this lock namespace while flows are open.
      const lockId = Buffer.from(key, 'hex').readBigInt64BE(0);
      // Prisma cannot deserialize PostgreSQL void. The text projection preserves
      // exactly the same transaction-scoped lock acquisition and lifetime.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockId}::bigint)::text AS locked`;
    }
  }
  async function accept({ rawBody, items, receivedAt, authenticationKeyVersion }) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length > 1024 * 1024 || !Array.isArray(items) || !items.length
      || !(receivedAt instanceof Date) || !Number.isFinite(+receivedAt) || !/^[a-zA-Z0-9_-]{1,64}$/.test(authenticationKeyVersion || '')) fail('META_INBOX_INVALID_BATCH');
    return atomic(async (tx, now, endpoint) => {
      if (!endpoint.inboxEnabled) fail('META_INBOX_ACCEPTANCE_DISABLED');
      await lockRecipients(tx, items.map(item => item.streamSender));
      const streams = items.map(item => item.streamSender ? crypto.stream(endpointId, item.streamSender) : null);
      await lockStreams(tx, streams);
      const receiptId = randomUUID(), counts = { itemCount: items.length, newCount: 0, duplicateCount: 0, conflictCount: 0 };
      await tx.metaWebhookReceipt.create({ data: { id: receiptId, endpointId, receivedAt, storedAt: now,
        requestDigest: crypto.digest(endpointId, 'request-v1', rawBody.toString('base64')), digestKeyVersion: crypto.currentLookupVersion,
        authenticationKeyVersion, requestBytes: rawBody.length, ...counts, itemCount: 0, expiresAt: new Date(+now + 7 * day) } });
      for (let index = 0; index < items.length; index++) {
        const item = items[index], itemId = randomUUID();
        const candidates = crypto.lookupVersions.map(v => ({ lookupKeyVersion: v, identityKey: crypto.digest(endpointId, 'identity-v1', item.identity, v) }));
        const matches = await tx.metaWebhookEvent.findMany({ where: { endpointId, identityVersion: 1, OR: candidates }, take: 2 });
        if (matches.length > 1) fail('META_INBOX_AMBIGUOUS_IDENTITY');
        let event = matches[0], disposition = 'NEW', conflictPayloadCiphertext = null, encryptionKeyVersion = null;
        const keyVersion = event?.lookupKeyVersion ?? crypto.currentLookupVersion;
        const contentDigest = crypto.digest(endpointId, 'content-v1', item.projection, keyVersion);
        if (event) {
          if (!same(event.contentDigest, contentDigest)) {
            disposition = 'CONFLICT'; counts.conflictCount++;
            const sealed = crypto.seal(item.data, [endpointId, 'receipt-item', itemId, contentDigest.toString('hex')]);
            conflictPayloadCiphertext = sealed.ciphertext; encryptionKeyVersion = sealed.keyVersion;
          } else { disposition = 'DUPLICATE'; counts.duplicateCount++; }
          const terminal = ['PROCESSED', 'IGNORED'].includes(event.state);
          await tx.metaWebhookEvent.updateMany({ where: { endpointId, id: event.id }, data: { receiptCount: { increment: 1n }, lastReceivedAt: new Date(Math.max(+event.lastReceivedAt, +receivedAt)),
            ...(disposition === 'CONFLICT' ? { hasConflict: true, reviewRequired: true,
              ...(!terminal ? { state: 'FAILED', failedAt: now, reasonCode: 'CONTENT_CONFLICT', nextAttemptAt: null, ...clearLease } : {}) } : {}) } });
        } else {
          counts.newCount++;
          const eventId = randomUUID(), sealed = crypto.seal(item.data, [endpointId, 'event', eventId, contentDigest.toString('hex')]);
          const unsupported = item.kind === 'UNSUPPORTED';
          event = await tx.metaWebhookEvent.create({ data: { id: eventId, endpointId, kind: item.kind,
            nativeMessageId: item.nativeMessageId, nativeStatus: item.nativeStatus, occurredAt: item.occurredAt,
            occurredAtSource: item.occurredAt ? 'meta-seconds' : null, identityVersion: 1, normalizationVersion: 1,
            lookupKeyVersion: keyVersion, identityKey: candidates.find(c => c.lookupKeyVersion === keyVersion).identityKey, contentDigest,
            correlationKeyHash: item.data.status?.biz_opaque_callback_data ? crypto.digest(endpointId, 'correlation-v1', item.data.status.biz_opaque_callback_data, keyVersion) : null,
            streamKey: streams[index], streamKeyVersion: streams[index] ? crypto.streamKeyVersion : null,
            firstReceivedAt: receivedAt, lastReceivedAt: receivedAt, storedAt: now, receiptCount: 1n,
            normalizedPayloadCiphertext: sealed.ciphertext, encryptionKeyVersion: sealed.keyVersion,
            state: unsupported ? 'FAILED' : 'READY', reasonCode: unsupported ? 'UNSUPPORTED_EVENT' : null,
            processingAttempts: 0, consecutiveFailures: 0, leaseGeneration: 0n, ...clearLease,
            hasConflict: false, reviewRequired: unsupported, nextAttemptAt: unsupported ? null : now,
            payloadExpiresAt: new Date(+now + 30 * day), tombstoneExpiresAt: new Date(+now + 90 * day), payloadPurgedAt: null,
            ...(unsupported ? { failedAt: now } : {}),
          } });
        }
        await tx.metaWebhookReceiptItem.create({ data: { id: itemId, endpointId, receiptId, eventId: event.id,
          ...item.position, disposition, observedContentDigest: contentDigest, conflictPayloadCiphertext, encryptionKeyVersion,
          payloadPurgedAt: null, createdAt: now, expiresAt: new Date(+now + (disposition === 'CONFLICT' ? 90 : 7) * day),
          conflictPayloadExpiresAt: disposition === 'CONFLICT' ? new Date(+now + 30 * day) : null } });
      }
      const actual = await tx.metaWebhookReceiptItem.count({ where: { endpointId, receiptId } });
      if (actual !== items.length || counts.newCount + counts.duplicateCount + counts.conflictCount !== items.length) fail('META_INBOX_INCOMPLETE_MANIFEST');
      await tx.metaWebhookReceipt.updateMany({ where: { endpointId, id: receiptId }, data: counts });
      return { receiptId, ...counts, accepted: true }; // Returned only after transaction commit.
    });
  }
  function lookup(id) {
    if (!uuid(id)) fail('META_INBOX_INVALID_ID');
    return atomic(tx => tx.metaWebhookEvent.findFirst({ where: { endpointId, id } }));
  }
  async function claim({ owner, leaseMs = 30000 } = {}) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(owner || '') || !Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 60000) fail('META_INBOX_INVALID_LEASE');
    return atomic(async (tx, now, endpoint) => {
      if (!endpoint.processingEnabled) fail('META_INBOX_PROCESSING_DISABLED');
      let after = null;
      while (true) {
        const rows = await tx.metaWebhookEvent.findMany({ where: { endpointId, ...(after === null ? {} : { enqueueOrder: { gt: after } }), hasConflict: false, payloadPurgedAt: null,
          payloadExpiresAt: { gt: now }, OR: [{ state: { in: ['READY', 'RETRY_WAIT', 'UNCORRELATED'] }, nextAttemptAt: { lte: now } },
            { state: 'PROCESSING', leaseExpiresAt: { lte: now } }] }, orderBy: { enqueueOrder: 'asc' }, take: 100 });
        if (!rows.length) return null;
        for (const event of rows) {
          if (event.streamKey) {
            const earlier = await tx.metaWebhookEvent.findFirst({ where: { endpointId, streamKey: event.streamKey,
              enqueueOrder: { lt: event.enqueueOrder }, OR: [{ state: { in: open } }, { hasConflict: true }] } });
            if (earlier) continue;
          }
          const token = randomUUID();
          const changed = await tx.metaWebhookEvent.updateMany({ where: { endpointId, id: event.id, state: event.state, leaseGeneration: event.leaseGeneration },
            data: { state: 'PROCESSING', leaseToken: token, leaseOwner: owner, leaseGeneration: { increment: 1n },
              processingAttempts: { increment: 1 }, leaseExpiresAt: new Date(+now + leaseMs) } });
          if (changed.count) return { id: event.id, token, generation: event.leaseGeneration + 1n };
        }
        after = rows[rows.length - 1].enqueueOrder;
      }
    });
  }
  async function owned(tx, lease, now) {
    if (!uuid(lease?.id) || !uuid(lease.token) || typeof lease.generation !== 'bigint') fail('META_INBOX_INVALID_LEASE');
    const event = await tx.metaWebhookEvent.findFirst({ where: { endpointId, id: lease.id, state: 'PROCESSING', leaseToken: lease.token,
      leaseGeneration: lease.generation, leaseExpiresAt: { gt: now }, payloadExpiresAt: { gt: now }, hasConflict: false, payloadPurgedAt: null } });
    if (!event) fail('META_INBOX_STALE_LEASE');
    return event;
  }
  async function mark(tx, event, lease, now, data) {
    const changed = await tx.metaWebhookEvent.updateMany({ where: { endpointId, id: event.id, state: 'PROCESSING',
      leaseToken: lease.token, leaseGeneration: lease.generation, leaseExpiresAt: { gt: now } }, data: { ...clearLease, ...data } });
    if (changed.count !== 1) fail('META_INBOX_STALE_LEASE');
  }
  async function processEvent(lease, effect) {
    if (typeof effect !== 'function') fail('META_INBOX_TRANSACTION_ADAPTER_REQUIRED');
    try {
      return await atomic(async (tx, now, endpoint) => {
        if (!endpoint.processingEnabled) fail('META_INBOX_PROCESSING_DISABLED');
        const event = await owned(tx, lease, now);
        await lockStreams(tx, [event.streamKey]);
        const started = (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0].now;
        await owned(tx, lease, started);
        const payload = crypto.open(event.normalizedPayloadCiphertext, event.encryptionKeyVersion,
          [endpointId, 'event', event.id, Buffer.from(event.contentDigest).toString('hex')]);
        const result = await effect(tx, event, payload, now);
        if (!['applied', 'ignored', 'uncorrelated', 'observed', 'failed'].includes(result?.outcome)) fail('META_INBOX_INVALID_EFFECT_RESULT');
        const state = { applied: 'PROCESSED', ignored: 'IGNORED', uncorrelated: 'UNCORRELATED', observed: 'PROCESSED', failed: 'FAILED' }[result.outcome];
        const allowedReasons = ['NATIVE_STATUS', 'MONOTONE_OR_DUPLICATE', 'CANCELLED', 'TERMINAL_FAILURE', 'DELIVERY_ALREADY_PROVEN',
          'NO_COMMON_IDENTIFIER', 'AMBIGUOUS_TARGET', 'IDENTIFIER_MISMATCH', 'TRANSACTION_ADAPTER_REQUIRED', 'INBOUND_APPLIED', 'INBOUND_DUPLICATE', 'OBSERVED_TECHNICAL_ERROR'];
        const finished = (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0].now;
        await mark(tx, event, lease, finished, { state, effectOutcome: result.outcome === 'applied' ? 'APPLIED' : result.outcome === 'ignored' ? 'DUPLICATE' : 'NONE',
          reasonCode: allowedReasons.includes(result.reason) ? result.reason : 'HANDLER_OUTCOME', nextAttemptAt: state === 'UNCORRELATED' ? new Date(+now + 30000) : null,
          ...(state === 'UNCORRELATED' ? { uncorrelatedSince: event.uncorrelatedSince || now } : ['PROCESSED', 'IGNORED'].includes(state) ? { processedAt: now } : {}),
          consecutiveFailures: 0,
          ...(state === 'FAILED' ? { failedAt: now, reviewRequired: true } : {}),
          ...(['PROCESSED', 'IGNORED'].includes(state) ? { payloadExpiresAt: new Date(Math.min(+event.payloadExpiresAt, +now + day)) } : {}) });
        return { id: event.id, state, outcome: result.outcome };
      });
    } catch (error) {
      if (['META_INBOX_STALE_LEASE', 'META_INBOX_INVALID_LEASE', 'META_INBOX_PROCESSING_DISABLED'].includes(error?.code)) throw error;
      // The effect transaction rolled back. Failures never authorize a send.
      return atomic(async (tx, now) => {
        const event = await owned(tx, lease, now), failures = event.consecutiveFailures + 1;
        const permanent = error?.code === 'META_INBOX_DECRYPTION_FAILED' || failures >= 10;
        const state = permanent ? 'FAILED' : 'RETRY_WAIT';
        await mark(tx, event, lease, now, { state, consecutiveFailures: failures, reviewRequired: permanent,
          reasonCode: permanent ? 'PROCESSING_FAILED' : 'TRANSIENT_PROCESSING_ERROR',
          nextAttemptAt: permanent ? null : new Date(+now + Math.min(3600000, 1000 * 2 ** failures)), ...(permanent ? { failedAt: now } : {}) });
        return { id: event.id, state, outcome: 'failed' };
      });
    }
  }
  function wake({ nativeMessageId, correlationKey } = {}) {
    if (!nativeMessageId && !correlationKey) fail('META_INBOX_EXACT_IDENTIFIER_REQUIRED');
    return atomic(async (tx, now) => {
      const OR = [...(nativeMessageId ? [{ nativeMessageId }] : []), ...(correlationKey ? crypto.lookupVersions.map(v => ({
        lookupKeyVersion: v, correlationKeyHash: crypto.digest(endpointId, 'correlation-v1', correlationKey, v),
      })) : [])];
      return tx.metaWebhookEvent.updateMany({ where: { endpointId, state: 'UNCORRELATED', OR, payloadExpiresAt: { gt: now }, hasConflict: false },
        data: { state: 'READY', nextAttemptAt: now } });
    });
  }
  function pendingIn(tx, streamKey) {
    return tx.metaWebhookEvent.findFirst({ where: { endpointId, kind: { in: ['INBOUND', 'UNSUPPORTED'] },
      AND: [{ OR: [{ streamKey }, { streamKey: null }] }, { OR: [{ state: { in: open } }, { hasConflict: true }] }] } });
  }
  async function canSubmitIn(tx, sender) {
    const endpoint = await tx.metaWebhookEndpoint.findFirst({ where: { id: endpointId,
      environment: fixed.environment, applicationKey: fixed.applicationKey, wabaId: fixed.wabaId,
      phoneNumberId: fixed.phoneNumberId, metaAppId: fixed.metaAppId, disabledAt: null,
      inboxEnabled: true, processingEnabled: true } });
    if (!endpoint || endpoint.identityVersion !== 1 || endpoint.normalizationVersion !== 1
      || endpoint.lookupKeyVersion !== crypto.currentLookupVersion || endpoint.streamKeyVersion !== crypto.streamKeyVersion) return false;
    // A wrong rotation/version must never hide a previously registered STOP.
    const incompatible = await tx.metaWebhookEvent.findFirst({ where: { endpointId, OR: [
      { lookupKeyVersion: { notIn: crypto.lookupVersions } },
      { streamKey: { not: null }, streamKeyVersion: { not: crypto.streamKeyVersion },
        OR: [{ state: { in: open } }, { hasConflict: true }] },
    ] } });
    return !incompatible && !await pendingIn(tx, crypto.stream(endpointId, sender.replace(/^\+/, '')));
  }
  async function inspectBarrier(sender) {
    const stream = crypto.stream(endpointId, sender);
    return atomic(async tx => { await lockStreams(tx, [stream]); return { blocked: Boolean(await pendingIn(tx, stream)),
      dispatchAuthorized: false, reason: 'OBSERVATION_ONLY_NOT_A_DISPATCH_PERMIT' }; });
  }
  // No live equivalent: executing a mock submission under a transaction is a
  // test of the ordering protocol, not a production network/commit boundary.
  async function simulateDispatch({ sender, claimAndSubmitMock, mode } = {}) {
    if (mode !== 'isolated' || process.env.NODE_ENV !== 'test' || fixed.environment !== 'test'
      || typeof claimAndSubmitMock !== 'function') fail('META_INBOX_REAL_DISPATCH_FORBIDDEN');
    const stream = crypto.stream(endpointId, sender);
    // Never automatically retry a callback representing a mock external send.
    return atomic(async (tx, now, endpoint) => {
      await lockStreams(tx, [stream]);
      if (!endpoint.inboxEnabled || !endpoint.processingEnabled) return { blocked: true, reason: 'INBOX_DISABLED' };
      if (await pendingIn(tx, stream)) return { blocked: true, reason: 'PENDING_INBOUND' };
      return claimAndSubmitMock(tx, now);
    }, false);
  }
  function expirePayloads() {
    return atomic(async (tx, now) => {
      const events = await tx.metaWebhookEvent.findMany({ where: { endpointId, payloadPurgedAt: null, payloadExpiresAt: { lte: now } }, take: 100 });
      for (const event of events) await tx.metaWebhookEvent.updateMany({ where: { endpointId, id: event.id }, data: {
        normalizedPayloadCiphertext: null, encryptionKeyVersion: null, payloadPurgedAt: now,
        ...(!['PROCESSED', 'IGNORED'].includes(event.state) ? { state: 'EXPIRED', reasonCode: 'PAYLOAD_EXPIRED', reviewRequired: true, nextAttemptAt: null, ...clearLease } : {}),
      } });
      const conflicts = await tx.metaWebhookReceiptItem.updateMany({ where: { endpointId, disposition: 'CONFLICT', payloadPurgedAt: null,
        conflictPayloadExpiresAt: { lte: now } }, data: { conflictPayloadCiphertext: null, encryptionKeyVersion: null, payloadPurgedAt: now } });
      return { expiredPayloads: events.length, expiredVariants: conflicts.count };
    });
  }
  return Object.freeze({ scope: fixed, accept, lookup, claim, process: processEvent, wake, inspectBarrier, simulateDispatch, expirePayloads, canSubmitIn });
}
module.exports = { createMetaInboxRepository };
