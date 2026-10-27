const { lockRecipients, unengaged } = require('./whatsappSubmissionCoordinator');
const { RETENTION_MS } = require('./whatsappFollowUp48Policy');
// Explicit maintenance only; importing this module never opens a database.
async function purgeInactiveProspects(database, { now = new Date(), dryRun = true } = {}) {
  const cutoff = new Date(+now - RETENTION_MS);
  const where = { userId: null, assignedAdvisorId: null, lastMessageAt: { lt: cutoff },
    admissionRequests: { none: {} }, controlState: { in: ['BOT_ACTIVE', 'OPTED_OUT', 'CLOSED'] } };
  const rows = await database.whatsAppConversation.findMany({ where, select: { id: true, phoneNumber: true }, take: 100, orderBy: { id: 'asc' } });
  if (dryRun) return { dryRun: true, candidates: rows.length };
  let purged = 0;
  for (const row of rows) await database.$transaction(async tx => {
    await lockRecipients(tx, [row.phoneNumber]);
    const current = await tx.whatsAppConversation.findFirst({ where: { ...where, id: row.id } });
    if (!current) return;
    await tx.whatsAppConversationMessage.updateMany({ where: { conversationId: row.id }, data: { body: null, interactivePayload: null } });
    await tx.whatsAppProspectFollowUp.updateMany({ where: { conversationId: row.id, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, ...unengaged }, data: { status: 'CANCELLED', cancelledAt: now, failureCode: 'RETENTION_EXPIRED' } });
    await tx.whatsAppConversation.update({ where: { id: row.id }, data: { engineState: { optedOut: current.controlState === 'OPTED_OUT' } } });
    purged++;
  }, { isolationLevel: 'ReadCommitted', timeout: 5000 });
  return { dryRun: false, purged };
}
module.exports = { purgeInactiveProspects };
