const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const cloudApi = require('./whatsappCloudApiService');
const { providerPhoneNumber } = require('../utils/phoneNumber');
const { classifySendError, retryDelay, applyDeliveryStatus } = require('./whatsappDeliveryPolicy');
const { engageSubmission, unengaged } = require('./whatsappSubmissionCoordinator');

const STALE_PROCESSING_MS = 15 * 60 * 1000;
const FOLLOW_UPS = [
  { hours: 24, configKey: 'prospectFollowUp24hTemplate' },
  { hours: 72, configKey: 'prospectFollowUp72hTemplate' },
];
const STATUS_RANK = { ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4 };

function createWhatsAppProspectFollowUpService({ client = prisma, sender = cloudApi.sendTemplateMessage, configProvider = getWhatsAppConfig, now = () => new Date(), submissionBarrier } = {}) {
  async function schedule({ conversationId, consentEventId, consentedAt }, database = client) {
    const config = configProvider();
    const conversation = await database.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { phoneNumber: true } });
    const phone = providerPhoneNumber(conversation?.phoneNumber);
    const users = phone ? await database.user.findMany({ where: { OR: [{ phoneNumber: `+${phone}` }, { whatsappNumber: `+${phone}` }] }, select: { id: true } }) : [];
    if (users.length && await database.enrollment.findFirst({ where: { userId: { in: users.map((user) => user.id) } }, select: { id: true } })) return [];
    const rows = [];
    for (const followUp of FOLLOW_UPS) {
      const templateName = config[followUp.configKey];
      if (!templateName) continue;
      const deduplicationKey = `wa-prospect-follow-up:consent-${consentEventId}:${followUp.hours}h`;
      rows.push(await database.whatsAppProspectFollowUp.upsert({
        where: { deduplicationKey },
        create: {
          conversationId, consentEventId, sequenceHours: followUp.hours,
          templateName, templateLanguage: 'fr', templateParameters: [],
          deduplicationKey, scheduledFor: new Date(new Date(consentedAt).getTime() + followUp.hours * 60 * 60 * 1000),
        },
        update: {},
      }));
    }
    return rows;
  }

  async function cancelForConversation(conversationId, failureCode = 'FOLLOW_UP_CANCELLED', database = client) {
    return database.whatsAppProspectFollowUp.updateMany({
      where: { conversationId, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }, ...unengaged },
      data: { status: 'CANCELLED', cancelledAt: now(), failureCode },
    });
  }

  async function cancelForPhoneNumbers(phoneNumbers, failureCode = 'ENROLLED') {
    const normalized = [...new Set((phoneNumbers || []).map((phone) => providerPhoneNumber(phone) ? `+${providerPhoneNumber(phone)}` : null).filter(Boolean))];
    if (!normalized.length) return { count: 0 };
    return client.whatsAppProspectFollowUp.updateMany({
      where: { conversation: { phoneNumber: { in: normalized } }, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
      data: { status: 'CANCELLED', cancelledAt: now(), failureCode },
    });
  }

  async function recoverAbandoned() {
    return client.whatsAppProspectFollowUp.updateMany({
      where: { status: 'PROCESSING', updatedAt: { lt: new Date(now().getTime() - STALE_PROCESSING_MS) } },
      data: { status: 'FAILED', processingStartedAt: null, failureCode: 'DELIVERY_UNCERTAIN' },
    });
  }

  async function sendFollowUp(id) {
    const config = configProvider(process.env, { requireValid: true });
    if (!config.enabled) return { skipped: true };
    const claim = await client.whatsAppProspectFollowUp.updateMany({
      where: { id, status: 'PENDING', scheduledFor: { lte: now() }, attempts: { lt: config.maxAttempts } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: now(), failureCode: null },
    });
    if (!claim.count) return { skipped: true };
    const found = await client.whatsAppProspectFollowUp.findUnique({ where: { id }, include: { conversation: true, consentEvent: true } });
    const row = found && { ...found };
    if (!row || row.status !== 'PROCESSING') return { skipped: true };
    const recipient = providerPhoneNumber(row?.conversation?.phoneNumber);
    const latestConsent = row && await client.whatsAppCommercialConsentEvent.findFirst({
      where: { conversationId: row.conversationId, scope: 'COMMERCIAL_FOLLOW_UPS' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const blockedState = !row?.conversation || row.conversation.controlState !== 'BOT_ACTIVE';
    const invalidConsent = latestConsent?.decision !== 'GRANTED' || latestConsent?.id !== row?.consentEventId;
    const templateStillConfigured = row && [config.prospectFollowUp24hTemplate, config.prospectFollowUp72hTemplate].includes(row.templateName);
    const users = recipient ? await client.user.findMany({ where: { OR: [{ phoneNumber: `+${recipient}` }, { whatsappNumber: `+${recipient}` }] }, select: { id: true } }) : [];
    const enrolled = users.length ? Boolean(await client.enrollment.findFirst({ where: { userId: { in: users.map((user) => user.id) } }, select: { id: true } })) : false;
    if (!recipient || blockedState || invalidConsent || !templateStillConfigured || enrolled) {
      await client.whatsAppProspectFollowUp.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'CANCELLED', processingStartedAt: null, cancelledAt: now(), failureCode: enrolled ? 'ENROLLED' : 'FOLLOW_UP_NOT_AUTHORIZED' } });
      return { cancelled: true };
    }

    const active = await client.whatsAppProspectFollowUp.findUnique({ where: { id } });
    if (active?.status !== 'PROCESSING' || active.attempts !== row.attempts) return { skipped: true };

    try {
      if (!await engageSubmission({ database: client, kind: 'prospect', id, attempts: row.attempts,
        phoneNumber: row.conversation.phoneNumber, config, barrier: submissionBarrier })) return { cancelled: true };
      const result = await sender({ phoneNumber: row.conversation.phoneNumber, templateName: row.templateName, templateLanguage: row.templateLanguage, templateParameters: row.templateParameters || [], idempotencyKey: row.deduplicationKey }, { config });
      const update = await client.whatsAppProspectFollowUp.updateMany({
        where: { id, status: 'PROCESSING', attempts: row.attempts }, data: { status: 'ACCEPTED', providerMessageId: result.providerMessageId, acceptedAt: now(), failedAt: null, processingStartedAt: null },
      });
      return update.count ? { accepted: true } : { accepted: true, statusRecordedByWebhook: true };
    } catch (error) {
      const outcome = classifySendError(error);
      const retryable = outcome.retryable && row.attempts < config.maxAttempts;
      const delayMs = retryDelay(row.attempts);
      await client.whatsAppProspectFollowUp.updateMany({
        where: { id, status: 'PROCESSING', attempts: row.attempts },
        data: { status: retryable ? 'PENDING' : 'FAILED', processingStartedAt: null, failedAt: now(), failureCode: outcome.failureCode, ...(retryable ? { scheduledFor: new Date(now().getTime() + delayMs) } : {}) },
      });
      return { failed: true, retryable };
    }
  }

  async function processPending() {
    const config = configProvider(process.env, { requireValid: true });
    if (!config.enabled) return [];
    await recoverAbandoned();
    const rows = await client.whatsAppProspectFollowUp.findMany({
      where: { status: 'PENDING', scheduledFor: { lte: now() }, attempts: { lt: config.maxAttempts } },
      select: { id: true }, orderBy: { scheduledFor: 'asc' }, take: config.batchSize,
    });
    const results = [];
    for (const row of rows) results.push(await sendFollowUp(row.id));
    return results;
  }

  async function applyStatus(item, { detailed = false } = {}) {
    return applyDeliveryStatus({ model: client.whatsAppProspectFollowUp, item, now, detailed });
  }

  return { schedule, cancelForConversation, cancelForPhoneNumbers, recoverAbandoned, sendFollowUp, processPending, applyStatus };
}

const defaultService = createWhatsAppProspectFollowUpService();
module.exports = { STALE_PROCESSING_MS, FOLLOW_UPS, STATUS_RANK, createWhatsAppProspectFollowUpService, ...defaultService };
