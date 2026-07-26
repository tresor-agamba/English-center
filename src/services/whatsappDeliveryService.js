const prisma = require('../utils/prisma');
const configModule = require('../config/whatsappConfig');
const templates = require('../config/whatsappTemplates');
const preferenceService = require('./whatsappPreferenceService');
const cloudApi = require('./whatsappCloudApiService');
const { maskPhoneNumber } = require('../utils/phoneNumber');

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
async function recoverAbandonedDeliveries(now = new Date()) {
  return prisma.whatsAppDelivery.updateMany({ where: { status: 'PROCESSING', processingStartedAt: { lt: new Date(now.getTime() - 15 * 60000) }, attempts: { lt: configModule.getWhatsAppConfig().maxAttempts } }, data: { status: 'PENDING', processingStartedAt: null, failureReason: 'Traitement interrompu.' } });
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
  const claim = await prisma.whatsAppDelivery.updateMany({ where: { id, status: { in: ['PENDING','FAILED'] }, attempts: { lt: config.maxAttempts }, scheduledFor: { lte: new Date() } }, data: { status: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: new Date(), lastAttemptAt: new Date(), failureCode: null, failureReason: null } });
  if (!claim.count) return { skipped: true };
  const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id } });
  const recipient = await preferenceService.canReceiveWhatsApp(delivery.userId);
  if (!recipient || !await isBusinessRelevant(delivery)) { await prisma.whatsAppDelivery.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), failureReason: 'Destinataire ou événement non autorisé.' } }); return { cancelled: true }; }
  try {
    const result = await cloudApi.sendTemplateMessage(delivery, { config });
    await prisma.whatsAppDelivery.update({ where: { id }, data: { status: 'ACCEPTED', providerMessageId: result.providerMessageId, acceptedAt: new Date(), processingStartedAt: null } });
    console.log(`Livraison WhatsApp acceptée : id interne ${id}`);
    return { accepted: true };
  } catch (error) {
    const attempts = delivery.attempts, retryable = error.retryable === true && attempts < config.maxAttempts;
    const delays = [60000, 300000, 1800000];
    await prisma.whatsAppDelivery.update({ where: { id }, data: { status: 'FAILED', failedAt: new Date(), processingStartedAt: null, failureCode: String(error.code || 'SEND_ERROR').slice(0, 100), failureReason: retryable ? 'Échec temporaire.' : 'Échec permanent.', scheduledFor: retryable ? new Date(Date.now() + delays[Math.min(attempts - 1, 2)]) : delivery.scheduledFor } });
    return { failed: true, retryable };
  }
}
async function processPending() {
  const config = configModule.getWhatsAppConfig(process.env, { requireValid: true });
  await recoverAbandonedDeliveries();
  const rows = await prisma.whatsAppDelivery.findMany({ where: { status: { in: ['PENDING','FAILED'] }, scheduledFor: { lte: new Date() }, attempts: { lt: config.maxAttempts } }, select: { id: true }, orderBy: { scheduledFor: 'asc' }, take: config.batchSize });
  const results = []; for (const row of rows) results.push(await sendDelivery(row.id)); return results;
}
async function retryFailedDelivery(id) {
  const delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: Number(id) } });
  if (!delivery || !['FAILED'].includes(delivery.status)) { const error = new Error('Cette livraison ne peut pas être relancée.'); error.statusCode = 400; throw error; }
  if (!await preferenceService.canReceiveWhatsApp(delivery.userId)) { const error = new Error('Le consentement WhatsApp est absent.'); error.statusCode = 400; throw error; }
  return prisma.whatsAppDelivery.update({ where: { id: delivery.id }, data: { status: 'PENDING', scheduledFor: new Date(), failedAt: null, failureCode: null, failureReason: null } });
}
function list(status) { return prisma.whatsAppDelivery.findMany({ where: status ? { status } : {}, include: { user: { select: { firstName: true, lastName: true } }, notification: { select: { type: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }
module.exports = { createDeliveryFromNotification, cancelPendingForEntity, recoverAbandonedDeliveries, sendDelivery, processPending, retryFailedDelivery, list, maskPhoneNumber };
