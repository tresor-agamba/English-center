const defaultPrisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const templates = require('../config/whatsappTemplates');
const defaultPreferences = require('./whatsappPreferenceService');
const cloudApi = require('./whatsappCloudApiService');
const { maskPhoneNumber } = require('../utils/phoneNumber');
const { classifySendError, retryDelay, applyDeliveryStatus, UNCERTAIN } = require('./whatsappDeliveryPolicy');

function createWhatsAppDeliveryService({ client = defaultPrisma, configProvider = getWhatsAppConfig,
  preferences = defaultPreferences, sender = cloudApi.sendTemplateMessage, now = () => new Date() } = {}) {
  const prisma = client;
  const configModule = { getWhatsAppConfig: configProvider };
  const preferenceService = preferences;

  async function createDeliveryFromNotification(notificationId, client = prisma) {
    const config = configModule.getWhatsAppConfig();
    if (!config.enabled) return null;
    const notification = await client.notification.findUnique({ where: { id: notificationId }, include: { user: { select: { id: true, firstName: true } } } });
    if (!notification || !templates.WHATSAPP_ALLOWED_NOTIFICATION_TYPES.includes(notification.type)) return null;
    const recipient = await preferenceService.canReceiveWhatsApp(notification.userId, client);
    const template = templates.templateForNotification(notification);
    if (!recipient || !template) return null;
    return client.whatsAppDelivery.upsert({
      where: { deduplicationKey: `WHATSAPP:notification-${notification.id}:user-${notification.userId}` },
      create: { notificationId: notification.id, userId: notification.userId, phoneNumber: recipient.phoneNumber, templateName: template.templateName, templateLanguage: template.languageCode, templateParameters: template.parameters, deduplicationKey: `WHATSAPP:notification-${notification.id}:user-${notification.userId}` },
      update: {},
    });
  }
  async function recoverAbandonedDeliveries(current = now()) {
    return prisma.whatsAppDelivery.updateMany({ where: { status: 'PROCESSING', updatedAt: { lt: new Date(current.getTime() - 15 * 60000) } }, data: { status: 'FAILED', processingStartedAt: null, failedAt: current, failureCode: UNCERTAIN, failureReason: 'Résultat incertain après interruption ; aucun renvoi automatique.' } });
  }
  function cancelPendingForEntity(relatedEntity, relatedId) {
    return prisma.whatsAppDelivery.updateMany({ where: { status: { in: ['PENDING','PROCESSING','FAILED'] }, notification: { relatedEntity, relatedId } }, data: { status: 'CANCELLED', cancelledAt: new Date(), failureReason: 'Événement devenu invalide.' } });
  }
  async function isBusinessRelevant(delivery) {
    const notification = await prisma.notification.findUnique({ where: { id: delivery.notificationId }, select: { type: true, relatedEntity: true, relatedId: true } });
    if (!notification) return false;
    if (notification.relatedEntity === 'CLASS_MEETING') {
      const meeting = await prisma.classMeeting.findUnique({ where: { id: notification.relatedId }, select: { status: true, trainingSessionId: true } });
      if (!meeting || meeting.status === 'CANCELLED') return notification.type === 'LIVE_CLASS_CANCELLED';
      const [enrollment, assignment] = await Promise.all([
        prisma.enrollment.findFirst({ where: { userId: delivery.userId, trainingSessionId: meeting.trainingSessionId, status: { in: ['TRIAL_ACTIVE','CONFIRMED'] } }, select: { id: true } }),
        prisma.trainingSessionTeacher.findFirst({ where: { teacherId: delivery.userId, trainingSessionId: meeting.trainingSessionId }, select: { id: true } }),
      ]);
      return Boolean(enrollment || assignment);
    }
    if (notification.relatedEntity === 'ASSIGNMENT') {
      const assignment = await prisma.assignment.findUnique({ where: { id: notification.relatedId }, select: { isPublished: true, courseId: true, trainingSessionId: true } });
      if (!assignment?.isPublished) return false;
      return Boolean(await prisma.enrollment.findFirst({ where: { userId: delivery.userId, status: { in: ['TRIAL_ACTIVE','CONFIRMED'] }, trainingSession: { courseId: assignment.courseId }, ...(assignment.trainingSessionId ? { trainingSessionId: assignment.trainingSessionId } : {}) }, select: { id: true } }));
    }
    return true;
  }
  async function sendDelivery(id) {
    const config = configModule.getWhatsAppConfig(process.env, { requireValid: true });
    if (!config.enabled) return { skipped: true };
    const startedAt = now();
    const claim = await prisma.whatsAppDelivery.updateMany({ where: { id, status: 'PENDING', attempts: { lt: config.maxAttempts }, scheduledFor: { lte: startedAt } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: startedAt, lastAttemptAt: startedAt, failureCode: null, failureReason: null } });
    if (!claim.count) return { skipped: true };
    const found = await prisma.whatsAppDelivery.findUnique({ where: { id } });
    const delivery = found && { ...found };
    if (!delivery || delivery.status !== 'PROCESSING') return { skipped: true };
    const recipient = await preferenceService.canReceiveWhatsApp(delivery.userId);
    if (!recipient || !await isBusinessRelevant(delivery)) { await prisma.whatsAppDelivery.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'CANCELLED', processingStartedAt: null, cancelledAt: now(), failureReason: 'Destinataire ou événement non autorisé.' } }); return { cancelled: true }; }
    const active = await prisma.whatsAppDelivery.findUnique({ where: { id } });
    if (active?.status !== 'PROCESSING' || active.attempts !== delivery.attempts) return { skipped: true };
    try {
      const result = await sender({ ...delivery, idempotencyKey: delivery.deduplicationKey }, { config });
      const update = await prisma.whatsAppDelivery.updateMany({ where: { id, status: 'PROCESSING', attempts: delivery.attempts }, data: { status: 'ACCEPTED', providerMessageId: result.providerMessageId, acceptedAt: now(), failedAt: null, processingStartedAt: null } });
      console.log(`Livraison WhatsApp acceptée : id interne ${id}`);
      return update.count ? { accepted: true } : { accepted: true, statusRecordedByWebhook: true };
    } catch (error) {
      const outcome = classifySendError(error);
      const retryable = outcome.retryable && delivery.attempts < config.maxAttempts;
      await prisma.whatsAppDelivery.updateMany({ where: { id, status: 'PROCESSING', attempts: delivery.attempts }, data: { status: retryable ? 'PENDING' : 'FAILED', failedAt: now(), processingStartedAt: null, failureCode: outcome.failureCode, failureReason: outcome.uncertain ? 'Résultat incertain ; aucun renvoi automatique.' : retryable ? 'Échec temporaire avec rejet confirmé.' : 'Échec permanent ou tentatives épuisées.', scheduledFor: retryable ? new Date(now().getTime() + retryDelay(delivery.attempts)) : delivery.scheduledFor } });
      return { failed: true, retryable };
    }
  }
  async function processPending() {
    const config = configModule.getWhatsAppConfig(process.env, { requireValid: true });
    if (!config.enabled) return [];
    await recoverAbandonedDeliveries();
    const rows = await prisma.whatsAppDelivery.findMany({ where: { status: 'PENDING', scheduledFor: { lte: now() }, attempts: { lt: config.maxAttempts } }, select: { id: true }, orderBy: { scheduledFor: 'asc' }, take: config.batchSize });
    const results = []; for (const row of rows) results.push(await sendDelivery(row.id)); return results;
  }
  async function retryFailedDelivery(id) {
    const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: Number(id) } });
    if (!delivery || !['FAILED'].includes(delivery.status)) { const error = new Error('Cette livraison ne peut pas être relancée.'); error.statusCode = 400; throw error; }
    const config = configModule.getWhatsAppConfig();
    if (!canRetryDelivery(delivery, config)) {
      const error = new Error('Réconciliation nécessaire ou limite de tentatives atteinte. Aucun renvoi autorisé.'); error.statusCode = 409; throw error;
    }
    if (!await preferenceService.canReceiveWhatsApp(delivery.userId)) { const error = new Error('Le consentement WhatsApp est absent.'); error.statusCode = 400; throw error; }
    const updated = await prisma.whatsAppDelivery.updateMany({ where: { id: delivery.id, status: 'FAILED', failureCode: delivery.failureCode, providerMessageId: null, attempts: delivery.attempts }, data: { status: 'PENDING', scheduledFor: now(), failedAt: null, failureCode: null, failureReason: null } });
    if (!updated.count) throw Object.assign(new Error('La livraison a changé ; relance refusée.'), { statusCode: 409 });
    return prisma.whatsAppDelivery.findUnique({ where: { id: delivery.id } });
  }
  function canRetryDelivery(delivery, config = configProvider()) {
    return delivery.status === 'FAILED' && !delivery.providerMessageId && delivery.failureCode !== UNCERTAIN
      && delivery.attempts < config.maxAttempts && delivery.failureReason === 'Échec permanent ou tentatives épuisées.';
  }
  async function list(status) {
    const rows = await prisma.whatsAppDelivery.findMany({ where: status ? { status } : {}, include: { user: { select: { firstName: true, lastName: true } }, notification: { select: { type: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(row => ({ ...row, canRetry: canRetryDelivery(row) }));
  }
  function applyStatus(item, { detailed = false } = {}) { return applyDeliveryStatus({ model: prisma.whatsAppDelivery, item, notification: true, now, detailed }); }
  return { createDeliveryFromNotification, cancelPendingForEntity, recoverAbandonedDeliveries, sendDelivery, processPending, retryFailedDelivery, canRetryDelivery, list, applyStatus, maskPhoneNumber };
}
module.exports = { createWhatsAppDeliveryService, ...createWhatsAppDeliveryService() };
