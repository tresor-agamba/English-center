const WINDOW_MS = 24 * 60 * 60 * 1000;
async function getServiceWindow(client, conversationId, current = new Date()) {
  const inbound = await client.whatsAppConversationMessage.findFirst({
    where: { conversationId, direction: 'INBOUND', providerTimestamp: { not: null, lte: current } },
    orderBy: [{ providerTimestamp: 'desc' }, { id: 'desc' }], select: { providerTimestamp: true },
  });
  const lastInboundAt = inbound?.providerTimestamp && new Date(inbound.providerTimestamp);
  const expiresAt = lastInboundAt && Number.isFinite(lastInboundAt.getTime()) ? new Date(lastInboundAt.getTime() + WINDOW_MS) : null;
  return { open: Boolean(expiresAt && current >= lastInboundAt && current < expiresAt), lastInboundAt: expiresAt ? lastInboundAt : null, expiresAt };
}
function isHandoffAcknowledgement(message) {
  return message.messageType === 'SYSTEM' && !message.senderUserId && /^wa-handoff:[^\s]+:0$/.test(message.idempotencyKey || '');
}
function canDeliverMessage(message, conversation) {
  if (!conversation || conversation.engineState?.optedOut || ['OPTED_OUT', 'CLOSED'].includes(conversation.controlState)) return false;
  if (message.senderUserId || (message.idempotencyKey || '').startsWith('wa-manual:')) return Boolean(message.senderUserId) && conversation.controlState === 'HUMAN_TAKEOVER' && conversation.assignedAdvisorId === message.senderUserId;
  if (isHandoffAcknowledgement(message)) return ['BOT_ACTIVE', 'HUMAN_TAKEOVER'].includes(conversation.controlState);
  return conversation.controlState === 'BOT_ACTIVE';
}
module.exports = { WINDOW_MS, getServiceWindow, isHandoffAcknowledgement, canDeliverMessage };
