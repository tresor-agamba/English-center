const { applyDeliveryStatus } = require('./whatsappDeliveryPolicy');
const { fail } = require('./metaInboxProtocol');
const circuits = [
  { model: 'whatsAppConversationMessage', key: 'idempotencyKey', field: 'deliveryStatus', conversation: true },
  { model: 'whatsAppProspectFollowUp', key: 'deduplicationKey', field: 'status' },
  { model: 'whatsAppDelivery', key: 'deduplicationKey', field: 'status', notification: true },
];
// Adapter is transaction-only: no HTTP, sender, timer or Prisma singleton.
function createMetaInboxDispatcher({ inboundTransaction } = {}) {
  return async function dispatch(tx, event, payload, now) {
    if (event.kind === 'PROVIDER_ERROR') return { outcome: 'observed', reason: 'OBSERVED_TECHNICAL_ERROR' };
    if (event.kind === 'INBOUND') {
      if (typeof inboundTransaction !== 'function') return { outcome: 'failed', reason: 'TRANSACTION_ADAPTER_REQUIRED' };
      const message = structuredClone(payload.message);
      if (!payload.timestampValidAtReceipt) delete message.timestamp;
      const result = await inboundTransaction(tx, message, Object.freeze({ endpointId: event.endpointId, firstReceivedAt: new Date(event.firstReceivedAt), processedAt: new Date(now) }));
      if (!result || typeof result.duplicate !== 'boolean' || typeof result.ignored !== 'boolean') fail('META_INBOX_INVALID_EFFECT_RESULT');
      return { outcome: result.duplicate || result.ignored ? 'ignored' : 'applied', reason: result.duplicate ? 'INBOUND_DUPLICATE' : 'INBOUND_APPLIED' };
    }
    if (event.kind !== 'STATUS') return { outcome: 'failed', reason: 'TRANSACTION_ADAPTER_REQUIRED' };
    const item = payload.status, candidates = [];
    for (const circuit of circuits) {
      const rows = await tx[circuit.model].findMany({ where: { OR: [{ providerMessageId: item.id },
        ...(item.biz_opaque_callback_data ? [{ [circuit.key]: item.biz_opaque_callback_data }] : [])] }, take: 2 });
      for (const row of rows) candidates.push({ circuit, row });
    }
    if (!candidates.length) return { outcome: 'uncorrelated', reason: 'NO_COMMON_IDENTIFIER' };
    if (candidates.length !== 1) return { outcome: 'failed', reason: 'AMBIGUOUS_TARGET' };
    const { circuit, row } = candidates[0];
    if ((circuit.conversation && row.direction !== 'OUTBOUND') || (row.providerMessageId && row.providerMessageId !== item.id)
      || (item.biz_opaque_callback_data && row[circuit.key] !== item.biz_opaque_callback_data)) return { outcome: 'failed', reason: 'IDENTIFIER_MISMATCH' };
    const result = await applyDeliveryStatus({ model: tx[circuit.model], item, stateField: circuit.field, correlationField: circuit.key,
      conversation: circuit.conversation, notification: circuit.notification, now: () => now, detailed: true });
    return { ...result, reason: result.reason || 'NATIVE_STATUS' };
  };
}
module.exports = { createMetaInboxDispatcher };
