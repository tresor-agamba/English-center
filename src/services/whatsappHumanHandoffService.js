const crypto = require('crypto');
const prisma = require('../utils/prisma');
const logger = require('./loggerService');
const followUps = require('./whatsappProspectFollowUpService');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { getServiceWindow } = require('./whatsappServiceWindow');
const { parseConversationId } = require('./whatsappConversationAdminService');
const MAX_MANUAL_LENGTH = 4000;
function refuse(message, statusCode = 409) { return Object.assign(new Error(message), { statusCode, code: 'WHATSAPP_HUMAN_ACTION_REFUSED' }); }
function createWhatsAppHumanHandoffService({ client = prisma, configProvider = getWhatsAppConfig, now = () => new Date(), audit = logger.audit } = {}) {
  async function transaction(work) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await client.$transaction(work, { isolationLevel: 'Serializable' }); }
      catch (error) { if (['P2034', 'P2002'].includes(error.code) && attempt < 2) continue; throw error; }
    }
  }
  async function authorize(tx, actorId) {
    if (!Number.isSafeInteger(actorId) || actorId < 1) throw refuse('Accès administrateur requis.', 403);
    const user = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, isActive: true, mustChangePassword: true } });
    if (!user || user.role !== 'ADMIN' || !user.isActive || user.mustChangePassword) throw refuse('Accès administrateur requis.', 403);
  }
  async function getConversation(tx, id) {
    const row = await tx.whatsAppConversation.findUnique({ where: { id } });
    if (!row) throw refuse('Conversation introuvable.', 404);
    if (['OPTED_OUT', 'CLOSED'].includes(row.controlState) || row.engineState?.optedOut) throw refuse('Conversation arrêtée : aucune réponse ou reprise autorisée.');
    return row;
  }
  async function changeControl(rawId, actorId, action) {
    const id = parseConversationId(rawId);
    const result = await transaction(async tx => {
      await authorize(tx, actorId);
      const row = await getConversation(tx, id);
      if (row.assignedAdvisorId && row.assignedAdvisorId !== actorId) throw refuse('Cette conversation est déjà attribuée à un autre administrateur.');
      const target = { TAKEOVER: 'HUMAN_TAKEOVER', PAUSE: 'BOT_PAUSED', RESUME: 'BOT_ACTIVE' }[action];
      if (row.controlState === target && (action !== 'TAKEOVER' || row.assignedAdvisorId === actorId)) return { conversation: row, unchanged: true };
      const at = now();
      const data = { controlState: target,
        engineState: { ...(row.engineState || {}), automationPaused: action !== 'RESUME' },
        ...(action === 'TAKEOVER' ? { assignedAdvisorId: actorId, handoffAt: at } : {}),
        ...(action === 'RESUME' ? { assignedAdvisorId: null, resumedAt: at } : {}),
      };
      const claim = await tx.whatsAppConversation.updateMany({ where: { id, controlState: row.controlState, assignedAdvisorId: row.assignedAdvisorId || null }, data });
      if (!claim.count) throw refuse('La conversation a changé. Rechargez la page.');
      // Never revive old queued responses when returning the conversation to the bot.
      await tx.whatsAppConversationMessage.updateMany({ where: { conversationId: id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED', messageType: { not: 'SYSTEM' } }, data: { deliveryStatus: 'CANCELLED', failureCode: 'CONTROL_STATE_CHANGED' } });
      if (action !== 'RESUME') await followUps.cancelForConversation(id, 'HUMAN_CONTROL', tx);
      const event = await tx.whatsAppConversationMessage.create({ data: { conversationId: id, direction: 'OUTBOUND', messageType: 'SYSTEM', senderUserId: actorId,
        body: `Administrateur #${actorId} · ${action} : ${row.controlState} → ${target}`, receivedAt: at, idempotencyKey: `wa-control:${crypto.randomUUID()}` } });
      return { conversation: { ...row, ...data }, eventId: event.id, before: row.controlState, after: target };
    });
    if (!result.unchanged) audit('WHATSAPP_CONTROL_CHANGED', { actorId, conversationId: id, messageId: result.eventId, before: result.before, after: result.after });
    return result.conversation;
  }
  async function queueManualReply(rawId, actorId, body, submissionId) {
    const id = parseConversationId(rawId);
    if (typeof body !== 'string' || !body.trim()) throw refuse('Le message ne peut pas être vide.', 400);
    if (body.length > MAX_MANUAL_LENGTH) throw refuse(`Le message est limité à ${MAX_MANUAL_LENGTH} caractères.`, 400);
    if (typeof submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) throw refuse('Identifiant de formulaire invalide. Rechargez la page.', 400);
    const text = body.trim();
    const key = `wa-manual:${id}:${submissionId}`;
    const result = await transaction(async tx => {
      await authorize(tx, actorId);
      const row = await getConversation(tx, id);
      if (row.controlState !== 'HUMAN_TAKEOVER' || row.assignedAdvisorId !== actorId) throw refuse('Prenez la conversation en charge avant de répondre.');
      const existing = await tx.whatsAppConversationMessage.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (existing.senderUserId !== actorId || existing.body !== text) throw refuse('Ce formulaire a déjà été utilisé pour un autre message. Rechargez la page.');
        return { message: existing, duplicate: true };
      }
      if (!configProvider().enabled) throw refuse('Le canal WhatsApp est désactivé.');
      if (!(await getServiceWindow(tx, id, now())).open) throw refuse('La fenêtre de service de 24 heures est fermée. Attendez un nouveau message du contact.');
      const message = await tx.whatsAppConversationMessage.create({ data: { conversationId: id, direction: 'OUTBOUND', messageType: 'TEXT', body: text,
        senderUserId: actorId, idempotencyKey: key, deliveryStatus: 'QUEUED', receivedAt: now() } });
      return { message, duplicate: false };
    });
    if (!result.duplicate) audit('WHATSAPP_MANUAL_REPLY_QUEUED', { actorId, conversationId: id, messageId: result.message.id, status: result.message.deliveryStatus });
    return result;
  }
  return { queueManualReply, takeOver: (id, actor) => changeControl(id, actor, 'TAKEOVER'), pause: (id, actor) => changeControl(id, actor, 'PAUSE'), resume: (id, actor) => changeControl(id, actor, 'RESUME') };
}
module.exports = { MAX_MANUAL_LENGTH, createWhatsAppHumanHandoffService, ...createWhatsAppHumanHandoffService() };
