const prisma = require('../utils/prisma');
const cloud = require('./whatsappCloudApiService');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { normalizePhoneNumber, isValidWhatsAppPhoneNumber } = require('../utils/phoneNumber');

const OCCUPYING = ['TRIAL_ACTIVE', 'PLACEMENT_TEST_REQUIRED', 'PAYMENT_REQUIRED', 'CONFIRMED'];
const INVITE_LINK = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]{10,100}$/;
const RETRYABLE_RESULT = new Set(['429', 'WHATSAPP_CONSENT_REQUIRED', 'INVALID_WHATSAPP_NUMBER', 'APPROVED_TEMPLATE_NOT_CONFIGURED', 'WHATSAPP_DISABLED']);
const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

function validateGroupInput({ name, invitationLink, status = 'ACTIVE' }) {
  const cleanName = String(name || '').trim();
  const link = String(invitationLink || '').trim();
  if (!cleanName || cleanName.length > 160) throw Object.assign(new Error('Le nom du groupe est obligatoire (160 caractères maximum).'), { statusCode: 400 });
  if (!INVITE_LINK.test(link)) throw Object.assign(new Error('Le lien doit être un lien d’invitation WhatsApp valide.'), { statusCode: 400 });
  if (!['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(status)) throw Object.assign(new Error('Statut de groupe invalide.'), { statusCode: 400 });
  return { name: cleanName, invitationLink: link, status };
}

function createWhatsAppSessionGroupService({ client = prisma, sender = cloud.sendTemplateMessage, env = process.env, now = () => new Date() } = {}) {
  async function saveGroup(trainingSessionId, input) {
    const data = validateGroupInput(input);
    return client.whatsAppSessionGroup.upsert({
      where: { trainingSessionId: Number(trainingSessionId) },
      create: { trainingSessionId: Number(trainingSessionId), ...data },
      update: data,
    });
  }

  async function listStudents(trainingSessionId) {
    return client.enrollment.findMany({
      where: { trainingSessionId: Number(trainingSessionId), status: { in: OCCUPYING } },
      include: { user: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, whatsappNumber: true, whatsappPreference: true } }, whatsAppSessionInvitation: true },
      orderBy: [{ user: { lastName: 'asc' } }, { id: 'asc' }],
    });
  }

  async function prepareForEnrollment(enrollmentId) {
    const enrollment = await client.enrollment.findUnique({ where: { id: enrollmentId }, include: { trainingSession: { include: { whatsAppGroup: true } } } });
    const group = enrollment?.trainingSession?.whatsAppGroup;
    if (!enrollment || !group || group.status !== 'ACTIVE' || !OCCUPYING.includes(enrollment.status)) return null;
    const row = await client.whatsAppSessionInvitation.upsert({
      where: { enrollmentId }, create: { groupId: group.id, enrollmentId },
      update: enrollment.whatsAppSessionInvitation?.groupId === group.id ? {} : { groupId: group.id, status: 'PENDING', attempts: 0, lastAttemptAt: null, lastResult: null, providerMessageId: null },
    });
    return row;
  }

  async function sendInvitation(invitationId) {
    const invitation = await client.whatsAppSessionInvitation.findUnique({ where: { id: Number(invitationId) }, include: { group: { include: { trainingSession: { include: { course: true } } } }, enrollment: { include: { user: { include: { whatsappPreference: true } } } } } });
    if (!invitation || invitation.group.status !== 'ACTIVE' || !OCCUPYING.includes(invitation.enrollment.status)) return { skipped: true, reason: 'INELIGIBLE' };
    if (['ACCEPTED', 'DELIVERED', 'JOINED', 'UNCERTAIN'].includes(invitation.status) || invitation.status === 'PROCESSING') return { skipped: true, reason: invitation.status === 'UNCERTAIN' ? 'DELIVERY_UNCERTAIN' : 'ALREADY_SENT' };
    if (invitation.lastResult === 'DELIVERY_UNCERTAIN') return { skipped: true, reason: 'DELIVERY_UNCERTAIN' };
    if (invitation.providerMessageId || (invitation.attempts > 0 && !RETRYABLE_RESULT.has(invitation.lastResult))) return { skipped: true, reason: 'PROVIDER_ACCEPTED_OR_UNCERTAIN' };
    if (invitation.idempotencyKey && !['429', 'RATE_LIMIT'].includes(invitation.lastResult)) return { skipped: true, reason: 'PROVIDER_ACCEPTED_OR_UNCERTAIN' };
    const config = getWhatsAppConfig(env);
    const preference = invitation.enrollment.user.whatsappPreference;
    if (!config.enabled || !preference?.isEnabled || !preference?.hasOptedIn) return markFailed(invitation, 'WHATSAPP_CONSENT_REQUIRED');
    const phoneNumber = normalizePhoneNumber(preference.phoneNumber || invitation.enrollment.user.whatsappNumber || invitation.enrollment.user.phoneNumber, config.defaultCountryCode);
    if (!isValidWhatsAppPhoneNumber(phoneNumber)) return markFailed(invitation, 'INVALID_WHATSAPP_NUMBER');
    const templateName = String(env.WHATSAPP_SESSION_INVITE_TEMPLATE || '').trim();
    const templateLanguage = String(env.WHATSAPP_SESSION_INVITE_LANGUAGE || 'fr').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(templateName) || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(templateLanguage)) return markFailed(invitation, 'APPROVED_TEMPLATE_NOT_CONFIGURED');
    const attemptNumber = invitation.attempts + 1;
    const correlationKey = `nva-session-invite:${invitation.id}:attempt:${attemptNumber}`;
    const claimed = await client.whatsAppSessionInvitation.updateMany({ where: { id: invitation.id, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: now(), lastResult: null, idempotencyKey: correlationKey } });
    if (!claimed.count) return { skipped: true, reason: 'NOT_RETRYABLE' };
    let providerAccepted = false;
    try {
      await client.whatsAppSessionInvitationAttempt.create({ data: { invitationId: invitation.id, attemptNumber, status: 'PROCESSING', idempotencyKey: correlationKey, startedAt: now() } });
      const result = await sender({ phoneNumber, templateName, templateLanguage, templateParameters: [
        invitation.enrollment.user.firstName,
        invitation.group.trainingSession.course.title,
        invitation.group.trainingSession.name,
        invitation.group.invitationLink,
      ], idempotencyKey: correlationKey }, { config });
      providerAccepted = true;
      await client.whatsAppSessionInvitationAttempt.updateMany({ where: { invitationId: invitation.id, attemptNumber, status: 'PROCESSING' }, data: { status: 'ACCEPTED', providerMessageId: result.providerMessageId, resultCode: 'ACCEPTED_BY_META', completedAt: now() } });
      const changed = await client.whatsAppSessionInvitation.updateMany({ where: { id: invitation.id, status: 'PROCESSING', attempts: attemptNumber }, data: { status: 'ACCEPTED', providerMessageId: result.providerMessageId, idempotencyKey: correlationKey, lastResult: 'ACCEPTED_BY_META' } });
      if (!changed.count) {
        const webhookWonRace = await client.whatsAppSessionInvitation.updateMany({ where: { id: invitation.id, status: { in: ['ACCEPTED', 'DELIVERED'] }, attempts: attemptNumber, idempotencyKey: correlationKey }, data: { providerMessageId: result.providerMessageId } });
        return { sent: webhookWonRace.count > 0, providerMessageId: result.providerMessageId, statusRecordedByWebhook: webhookWonRace.count > 0 };
      }
      return { sent: true, providerMessageId: result.providerMessageId };
    } catch (error) {
      // Uncertain submissions are not retried automatically: Meta may have accepted them.
      const resultCode = /^[A-Z0-9_-]{1,100}$/i.test(String(error.code || '')) ? String(error.code) : 'SEND_FAILED';
      const uncertain = error.uncertain === true || providerAccepted;
      const safeRetry = !uncertain && error.acceptanceRejected === true && error.retryable === true && ['429', 'RATE_LIMIT'].includes(resultCode);
      const finalStatus = uncertain ? 'UNCERTAIN' : 'FAILED';
      await client.whatsAppSessionInvitationAttempt.updateMany({ where: { invitationId: invitation.id, attemptNumber, status: 'PROCESSING' }, data: {
        status: uncertain ? 'UNCERTAIN' : 'FAILED', resultCode: uncertain ? 'DELIVERY_UNCERTAIN' : resultCode, completedAt: now(),
      } });
      await client.whatsAppSessionInvitation.updateMany({ where: { id: invitation.id, status: 'PROCESSING', attempts: attemptNumber }, data: {
        status: finalStatus, lastResult: uncertain ? 'DELIVERY_UNCERTAIN' : resultCode,
        ...(safeRetry ? { updatedAt: new Date(now().getTime() + 60_000) } : { idempotencyKey: null }),
      } });
      return { sent: false, failed: !uncertain, uncertain, result: uncertain ? 'DELIVERY_UNCERTAIN' : resultCode };
    }
  }

  async function markFailed(invitation, reason) {
    const attemptNumber = invitation.attempts + 1;
    const at = now();
    const changed = await client.whatsAppSessionInvitation.updateMany({ where: { id: invitation.id, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS } }, data: { status: 'FAILED', lastAttemptAt: at, lastResult: reason, attempts: { increment: 1 } } });
    if (changed.count) await client.whatsAppSessionInvitationAttempt.create({ data: { invitationId: invitation.id, attemptNumber, status: 'FAILED', resultCode: reason, startedAt: at, completedAt: at } });
    return { sent: false, failed: true, result: reason };
  }

  async function applyStatus(item, { detailed = false } = {}) {
    const finish = (outcome) => detailed ? { outcome } : ['applied', 'ignored'].includes(outcome);
    if (!item?.id || !['sent', 'delivered', 'read', 'failed'].includes(item.status)) return finish('invalid');
    const attempt = await client.whatsAppSessionInvitationAttempt.findUnique({ where: { providerMessageId: item.id } })
      || (item.biz_opaque_callback_data ? await client.whatsAppSessionInvitationAttempt.findUnique({ where: { idempotencyKey: item.biz_opaque_callback_data } }) : null);
    const row = attempt
      ? await client.whatsAppSessionInvitation.findUnique({ where: { id: attempt.invitationId } })
      : await client.whatsAppSessionInvitation.findUnique({ where: { providerMessageId: item.id } })
        || (item.biz_opaque_callback_data ? await client.whatsAppSessionInvitation.findUnique({ where: { idempotencyKey: item.biz_opaque_callback_data } }) : null);
    if (!row) return finish('uncorrelated');
    if (attempt?.providerMessageId && attempt.providerMessageId !== item.id) return finish('ignored');
    if (row.providerMessageId && row.providerMessageId !== item.id) return finish('ignored');
    const attemptIsLatest = !attempt || attempt.attemptNumber === row.attempts;
    if (attempt?.status === 'DELIVERED' && item.status !== 'read') return finish('ignored');
    if (attempt?.resultCode === 'READ' && item.status !== 'read') return finish('ignored');
    if (!attemptIsLatest) {
      const previousStatus = attempt.status;
      if (item.status === 'failed' && ['PROCESSING', 'ACCEPTED', 'UNCERTAIN'].includes(previousStatus)) {
        await client.whatsAppSessionInvitationAttempt.updateMany({ where: { id: attempt.id, status: previousStatus }, data: { status: 'FAILED', providerMessageId: item.id, resultCode: 'PROVIDER_FAILED', completedAt: now() } });
      } else if (['sent', 'delivered', 'read'].includes(item.status) && previousStatus !== 'FAILED') {
        const state = item.status === 'sent' ? 'ACCEPTED' : 'DELIVERED';
        const resultCode = item.status === 'read' ? 'READ' : item.status === 'delivered' ? 'DELIVERED' : 'ACCEPTED_BY_META';
        await client.whatsAppSessionInvitationAttempt.updateMany({ where: { id: attempt.id, status: previousStatus }, data: { status: state, providerMessageId: item.id, resultCode, completedAt: now() } });
      }
      return finish('applied');
    }
    if (item.status === 'failed') {
      if (row.status === 'FAILED') return finish('ignored');
      if (attempt) await client.whatsAppSessionInvitationAttempt.updateMany({ where: { id: attempt.id, status: { in: ['PROCESSING', 'ACCEPTED', 'UNCERTAIN'] } }, data: { status: 'FAILED', providerMessageId: item.id, resultCode: 'PROVIDER_FAILED', completedAt: now() } });
      await client.whatsAppSessionInvitation.updateMany({ where: { id: row.id, attempts: row.attempts, status: { in: ['PROCESSING', 'ACCEPTED', 'UNCERTAIN'] } }, data: { status: 'FAILED', providerMessageId: item.id, lastResult: 'PROVIDER_FAILED' } });
    } else {
      if (row.lastResult === 'READ' && item.status !== 'read') return finish('ignored');
      const result = item.status === 'delivered' ? 'DELIVERED' : item.status === 'read' ? 'READ' : 'ACCEPTED_BY_META';
      const status = ['delivered', 'read'].includes(item.status) ? 'DELIVERED' : 'ACCEPTED';
      if (attempt) await client.whatsAppSessionInvitationAttempt.updateMany({ where: { id: attempt.id, status: { in: ['PROCESSING', 'ACCEPTED', 'DELIVERED', 'UNCERTAIN'] } }, data: { status, providerMessageId: item.id, resultCode: result, completedAt: now() } });
      await client.whatsAppSessionInvitation.updateMany({ where: { id: row.id, attempts: row.attempts, status: { in: ['PROCESSING', 'ACCEPTED', 'DELIVERED', 'UNCERTAIN'] } }, data: { status: row.status === 'DELIVERED' ? 'DELIVERED' : status, providerMessageId: item.id, lastResult: result } });
    }
    return finish('applied');
  }

  async function sendSelected(trainingSessionId, enrollmentIds) {
    const group = await client.whatsAppSessionGroup.findUnique({ where: { trainingSessionId: Number(trainingSessionId) } });
    if (!group || group.status !== 'ACTIVE') throw Object.assign(new Error('Aucun groupe WhatsApp actif n’est associé à cette session.'), { statusCode: 400 });
    const uniqueIds = [...new Set(enrollmentIds.map(Number).filter(Number.isInteger))];
    const rows = await client.enrollment.findMany({ where: { id: { in: uniqueIds }, trainingSessionId: Number(trainingSessionId), status: { in: OCCUPYING } }, select: { id: true } });
    const ids = rows.map(row => row.id);
    const results = [];
    for (const enrollmentId of ids) {
      const row = await client.whatsAppSessionInvitation.upsert({ where: { enrollmentId }, create: { groupId: group.id, enrollmentId }, update: {} });
      if (row.providerMessageId || ['PROCESSING', 'ACCEPTED', 'DELIVERED', 'JOINED', 'UNCERTAIN'].includes(row.status)
        || (row.status === 'FAILED' && !RETRYABLE_RESULT.has(row.lastResult)) || row.attempts >= MAX_ATTEMPTS) {
        results.push({ skipped: true, reason: 'NOT_RETRYABLE' });
        continue;
      }
      await client.whatsAppSessionInvitation.updateMany({ where: { id: row.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PENDING', sendRequestedAt: now() } });
      results.push({ queued: true, invitationId: row.id });
    }
    return results;
  }

  async function recoverAbandoned() {
    const cutoff = new Date(now().getTime() - STALE_PROCESSING_MS);
    return client.whatsAppSessionInvitation.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { status: 'UNCERTAIN', lastResult: 'DELIVERY_UNCERTAIN' },
    });
  }

  async function processPending() {
    await recoverAbandoned();
    const current = now();
    const rows = await client.whatsAppSessionInvitation.findMany({
      where: {
        attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lte: current },
        group: { status: 'ACTIVE' }, enrollment: { status: { in: OCCUPYING } },
        OR: [
          { status: 'PENDING', ...(String(env.WHATSAPP_SESSION_INVITES_AUTOMATIC).toLowerCase() === 'true' ? {} : { sendRequestedAt: { not: null } }) },
          { status: 'FAILED', lastResult: '429' },
        ],
      },
      select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20,
    });
    const results = [];
    for (const row of rows) results.push(await sendInvitation(row.id));
    return results;
  }

  return { saveGroup, listStudents, prepareForEnrollment, sendInvitation, sendSelected, applyStatus, recoverAbandoned, processPending };
}

module.exports = { INVITE_LINK, OCCUPYING, MAX_ATTEMPTS, STALE_PROCESSING_MS, validateGroupInput, createWhatsAppSessionGroupService, ...createWhatsAppSessionGroupService() };
