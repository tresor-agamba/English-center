// Opt-in composition only. No singleton, transaction creation, sender or live wiring.
function createMetaInboxPrismaAdapter({ endpointId, conversationService } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(endpointId || '')
    || typeof conversationService?.processInboundMessageInTransaction !== 'function') {
    throw Object.assign(new Error('Invalid Meta inbox adapter configuration.'), { code: 'META_INBOX_INVALID_ADAPTER' });
  }
  return async function applyInbound(tx, message, context) {
    if (context?.endpointId !== endpointId || !tx || typeof tx.$transaction === 'function'
      || !(context.firstReceivedAt instanceof Date) || !(context.processedAt instanceof Date)
      || !Number.isFinite(+context.firstReceivedAt) || !Number.isFinite(+context.processedAt)
      || context.processedAt < context.firstReceivedAt) {
      throw Object.assign(new Error('Invalid Meta inbox transaction scope.'), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' });
    }
    // SQL errors must escape to the outer inbox transaction: never catch/retry here.
    return conversationService.processInboundMessageInTransaction(tx, message, context);
  };
}
module.exports = { createMetaInboxPrismaAdapter };
