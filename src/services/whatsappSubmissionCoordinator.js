// One database-wide recipient lock namespace, shared by ingress, STOP and egress.
// No network, timers, process-local locks, new tables or Provider* dependencies.
const { createHash } = require('node:crypto');
const { normalizePhoneNumber } = require('../utils/phoneNumber');
const { canDeliverMessage, getServiceWindow } = require('./whatsappServiceWindow');
const ENGAGED = 'SUBMISSION_ENGAGED';
const unengaged = { OR: [{ failureCode: null }, { failureCode: { not: ENGAGED } }] };
function recipientKey(phone) {
  const canonical = normalizePhoneNumber('+' + String(phone || '').replace(/\D/g, ''));
  if (!/^\+[1-9]\d{6,14}$/.test(canonical || '')) throw new Error('WHATSAPP_INVALID_COORDINATION_RECIPIENT');
  return createHash('sha256').update('nva-whatsapp-submission-v1:' + canonical).digest().readBigInt64BE();
}
async function lockRecipients(tx, phones) {
  if (typeof tx?.$queryRaw !== 'function') {
    // Pure injected unit-test models are not evidence of PostgreSQL coordination.
    if (process.env.NODE_ENV === 'test') return;
    throw new Error('WHATSAPP_TRANSACTION_REQUIRED');
  }
  const keys = [...new Set(phones.filter(Boolean).map(phone => recipientKey(phone).toString()))].map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  for (const key of keys) await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text AS locked`;
}
async function engageSubmission({ database, kind, id, attempts, phoneNumber, config, barrier }) {
  if (typeof database?.$transaction !== 'function' || typeof database?.$queryRaw !== 'function') {
    if (process.env.NODE_ENV === 'test') return true; // Legacy pure mocks only.
    throw new Error('WHATSAPP_TRANSACTION_REQUIRED');
  }
  const circuits = { conversation: ['whatsAppConversationMessage', 'deliveryStatus'],
    prospect: ['whatsAppProspectFollowUp', 'status'], notification: ['whatsAppDelivery', 'status'] };
  if (!circuits[kind]) throw new Error('WHATSAPP_INVALID_SUBMISSION_CIRCUIT');
  // READ COMMITTED is intentional: a lock wait must precede a fresh snapshot.
  // Never retry this transaction after an ambiguous commit.
  return database.$transaction(async tx => {
    await lockRecipients(tx, [phoneNumber]);
    const [model, field] = circuits[kind];
    const row = await tx[model].findUnique({ where: { id }, ...(kind === 'notification' ? {} : { include: { conversation: true } }) });
    if (!row || row[field] !== 'PROCESSING' || row.attempts !== attempts || row.providerMessageId || row.failureCode) return false;
    const now = (await tx.$queryRaw`SELECT clock_timestamp() AS now`)[0].now;
    let allowed = true;
    if (barrier) allowed = await barrier(tx, phoneNumber);
    else if (await tx.metaWebhookEndpoint.findFirst({ where: { disabledAt: null, inboxEnabled: true }, select: { id: true } })) {
      allowed = false; // Active inbox requires its explicit scoped pending-event barrier.
    }
    if (kind === 'conversation') {
      allowed = allowed && row.direction === 'OUTBOUND' && row.conversation?.phoneNumber === phoneNumber && canDeliverMessage(row, row.conversation);
      if (row.senderUserId) {
        const author = await tx.user.findUnique({ where: { id: row.senderUserId }, select: { role: true, isActive: true, mustChangePassword: true } });
        allowed = allowed && author?.role === 'ADMIN' && author.isActive && !author.mustChangePassword;
      }
      allowed = allowed && (await getServiceWindow(tx, row.conversationId, now)).open;
    } else if (kind === 'prospect') {
      const consent = await tx.whatsAppCommercialConsentEvent.findFirst({ where: { conversationId: row.conversationId, scope: 'COMMERCIAL_FOLLOW_UPS' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
      const users = await tx.user.findMany({ where: { OR: [{ phoneNumber }, { whatsappNumber: phoneNumber }] }, select: { id: true } });
      const enrolled = users.length && await tx.enrollment.findFirst({ where: { userId: { in: users.map(user => user.id) } }, select: { id: true } });
      allowed = allowed && row.conversation?.phoneNumber === phoneNumber && row.conversation.controlState === 'BOT_ACTIVE'
        && !row.conversation.engineState?.optedOut && consent?.decision === 'GRANTED' && consent.id === row.consentEventId
        && (config.followUp48h ? config.prospectFollowUpsEnabled === true && config.prospectFollowUpsDryRun === false
          && await require('./whatsappFollowUp48Policy').eligible48(tx, row, now, config)
          : [config.prospectFollowUp24hTemplate, config.prospectFollowUp72hTemplate].includes(row.templateName)) && !enrolled;
    } else {
      const user = await tx.user.findUnique({ where: { id: row.userId }, include: { whatsappPreference: true } });
      const pref = user?.whatsappPreference;
      const conversation = await tx.whatsAppConversation.findUnique({ where: { phoneNumber } });
      allowed = allowed && row.phoneNumber === phoneNumber && user?.isActive && pref?.isEnabled && pref.hasOptedIn
        && normalizePhoneNumber(pref.phoneNumber || user.phoneNumber, config.defaultCountryCode) === phoneNumber
        && conversation?.controlState !== 'OPTED_OUT' && !conversation?.engineState?.optedOut;
    }
    const where = { id, [field]: 'PROCESSING', attempts, providerMessageId: null, failureCode: null };
    if (!allowed) {
      await tx[model].updateMany({ where, data: { [field]: 'CANCELLED', processingStartedAt: null, failureCode: 'SUBMISSION_NOT_AUTHORIZED' } });
      return false;
    }
    // Durable linearization point. PROCESSING/null = reserved; this marker =
    // engaged, even if the worker crashes before the first physical network byte.
    return (await tx[model].updateMany({ where, data: { failureCode: ENGAGED } })).count === 1;
  }, { isolationLevel: 'ReadCommitted', timeout: 5000 });
}
module.exports = { ENGAGED, unengaged, recipientKey, lockRecipients, engageSubmission };
