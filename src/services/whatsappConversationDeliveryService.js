const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const cloudApi = require('./whatsappCloudApiService');
const { providerPhoneNumber } = require('../utils/phoneNumber');
const { classifySendError, retryDelay, applyDeliveryStatus } = require('./whatsappDeliveryPolicy');
const { getServiceWindow, canDeliverMessage } = require('./whatsappServiceWindow');
const { engageSubmission } = require('./whatsappSubmissionCoordinator');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;
const STATUS_RANK = { ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4 };

function createWhatsAppConversationDeliveryService({ client = prisma, sender = cloudApi.sendConversationMessage, configProvider = getWhatsAppConfig, now = () => new Date(), submissionBarrier } = {}) {
  async function recoverAbandoned() {
    const cutoff = new Date(now().getTime() - STALE_MS);
    return client.whatsAppConversationMessage.updateMany({
      where: { direction: 'OUTBOUND', deliveryStatus: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { deliveryStatus: 'FAILED', processingStartedAt: null, failureCode: 'DELIVERY_UNCERTAIN' },
    });
  }

  async function sendMessage(id) {
    const config = configProvider(process.env, { requireValid: true });
    if (!config.enabled) return { skipped: true };
    const candidate = await client.whatsAppConversationMessage.findUnique({ where: { id } });
    if (['AI_PENDING', 'AI_PROCESSING'].includes(candidate?.failureCode)) {
      const completion = await require('./whatsappChatbotAICompletionService').createAICompletionService({ database: client }).completeReply(candidate.idempotencyKey);
      if (completion.busy) return { skipped: true };
      // Disabled server AI releases the prewritten fallback without making a request.
      if (completion.skipped) await client.whatsAppConversationMessage.updateMany({
        where: { id, deliveryStatus: 'QUEUED', attempts: 0, failureCode: 'AI_PENDING' }, data: { failureCode: null },
      });
      const ready = await client.whatsAppConversationMessage.findUnique({ where: { id } });
      if (['AI_PENDING', 'AI_PROCESSING'].includes(ready?.failureCode)) return { skipped: true };
    }
    const startedAt = now();
    let claim = await client.whatsAppConversationMessage.updateMany({
      where: { id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED', attempts: { lt: config.maxAttempts }, updatedAt: { lte: startedAt } },
      data: { deliveryStatus: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: startedAt, failureCode: null },
    });
    if (!claim.count) claim = await client.whatsAppConversationMessage.updateMany({
      where: { id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED', textFallbackPending: true,
        attempts: { lt: config.maxAttempts + 1 }, updatedAt: { lte: startedAt } },
      data: { deliveryStatus: 'PROCESSING', attempts: { increment: 1 }, processingStartedAt: startedAt, failureCode: null },
    });
    if (!claim.count) return { skipped: true };

    const found = await client.whatsAppConversationMessage.findUnique({ where: { id }, include: { conversation: true } });
    const message = found && { ...found };
    if (!message || message.deliveryStatus !== 'PROCESSING') return { skipped: true };
    const conversation = message?.conversation;
    const recipient = providerPhoneNumber(conversation?.phoneNumber);
    if (!canDeliverMessage(message, conversation)) {
      await client.whatsAppConversationMessage.updateMany({ where: { id, deliveryStatus: 'PROCESSING' }, data: { deliveryStatus: 'CANCELLED', processingStartedAt: null, failureCode: 'AUTOMATION_NOT_ACTIVE' } });
      return { cancelled: true };
    }
    const serviceWindow = await getServiceWindow(client, message.conversationId, startedAt);
    if (!recipient || !serviceWindow.open) {
      await client.whatsAppConversationMessage.updateMany({ where: { id, deliveryStatus: 'PROCESSING' }, data: { deliveryStatus: 'FAILED', processingStartedAt: null, failureCode: 'CUSTOMER_SERVICE_WINDOW_EXPIRED' } });
      return { failed: true, retryable: false };
    }

    const active = await client.whatsAppConversationMessage.findUnique({ where: { id }, include: { conversation: true } });
    if (active?.deliveryStatus !== 'PROCESSING' || active.attempts !== message.attempts) return { skipped: true };
    let authorAllowed = true;
    if (message.senderUserId) {
      const author = await client.user.findUnique({ where: { id: message.senderUserId }, select: { role: true, isActive: true, mustChangePassword: true } });
      authorAllowed = author?.role === 'ADMIN' && author.isActive && !author.mustChangePassword;
    }
    if (!canDeliverMessage(active, active.conversation) || !authorAllowed) {
      await client.whatsAppConversationMessage.updateMany({ where: { id, deliveryStatus: 'PROCESSING' }, data: { deliveryStatus: 'CANCELLED', processingStartedAt: null, failureCode: 'AUTOMATION_NOT_ACTIVE' } });
      return { cancelled: true };
    }
    if (now() >= serviceWindow.expiresAt || now() < serviceWindow.lastInboundAt) {
      await client.whatsAppConversationMessage.updateMany({ where: { id, deliveryStatus: 'PROCESSING', attempts: message.attempts }, data: { deliveryStatus: 'FAILED', processingStartedAt: null, failureCode: 'CUSTOMER_SERVICE_WINDOW_EXPIRED' } });
      return { failed: true, retryable: false };
    }

    try {
      if (!await engageSubmission({ database: client, kind: 'conversation', id, attempts: message.attempts,
        phoneNumber: conversation.phoneNumber, config, barrier: submissionBarrier })) return { cancelled: true };
      const result = await sender({ phoneNumber: conversation.phoneNumber, text: message.body, ...(message.interactivePayload ? { interactive: message.interactivePayload } : {}), idempotencyKey: message.idempotencyKey }, { config });
      const updated = await client.whatsAppConversationMessage.updateMany({
        where: { id, deliveryStatus: 'PROCESSING', attempts: message.attempts },
        data: { deliveryStatus: 'ACCEPTED', providerMessageId: result.providerMessageId, providerTimestamp: now(), processingStartedAt: null, failureCode: null },
      });
      return updated.count ? { accepted: true } : { accepted: true, statusRecordedByWebhook: true };
    } catch (error) {
      // Requeue text only after a definitive interactive-format rejection.
      // A timeout, 5xx or ambiguous acceptance must never cause a second message.
      if (message.interactivePayload && error.acceptanceRejected === true && error.uncertain !== true
        && ['100', '131009', 'INVALID_INTERACTIVE'].includes(String(error.code))) {
        await client.whatsAppConversationMessage.updateMany({
          where: { id, deliveryStatus: 'PROCESSING', attempts: message.attempts },
          data: { deliveryStatus: 'QUEUED', interactivePayload: require('@prisma/client').Prisma.DbNull,
            textFallbackPending: true, processingStartedAt: null, failureCode: null },
        });
        return { failed: true, retryable: true, textFallback: true };
      }
      const outcome = classifySendError(error);
      const retryable = outcome.retryable && message.attempts < config.maxAttempts + (message.textFallbackPending ? 1 : 0);
      const delay = retryDelay(message.attempts);
      await client.whatsAppConversationMessage.updateMany({
        where: { id, deliveryStatus: 'PROCESSING', attempts: message.attempts },
        data: { deliveryStatus: retryable ? 'QUEUED' : 'FAILED', processingStartedAt: null, failureCode: outcome.failureCode, ...(retryable ? { updatedAt: new Date(now().getTime() + delay) } : {}) },
      });
      return { failed: true, retryable };
    }
  }

  async function processPending() {
    const config = configProvider(process.env, { requireValid: true });
    if (!config.enabled) return [];
    const current = now();
    await recoverAbandoned();
    const rows = await client.whatsAppConversationMessage.findMany({
      where: { direction: 'OUTBOUND', deliveryStatus: 'QUEUED', attempts: { lt: config.maxAttempts }, updatedAt: { lte: current } },
      select: { id: true }, orderBy: { createdAt: 'asc' }, take: config.batchSize,
    });
    const fallbacks = await client.whatsAppConversationMessage.findMany({
      where: { direction: 'OUTBOUND', deliveryStatus: 'QUEUED', textFallbackPending: true,
        attempts: { lt: config.maxAttempts + 1 }, updatedAt: { lte: current } },
      select: { id: true }, orderBy: { createdAt: 'asc' }, take: config.batchSize,
    });
    const pending = [...new Map([...rows, ...fallbacks].map(row => [row.id, row])).values()].slice(0, config.batchSize);
    const results = [];
    for (const row of pending) results.push(await sendMessage(row.id));
    return results;
  }

  async function applyStatus(item, { detailed = false } = {}) {
    return applyDeliveryStatus({ model: client.whatsAppConversationMessage, item, stateField: 'deliveryStatus', correlationField: 'idempotencyKey', conversation: true, now, detailed });
  }

  return { recoverAbandoned, sendMessage, processPending, applyStatus };
}

const defaultService = createWhatsAppConversationDeliveryService();
module.exports = { WINDOW_MS, STALE_MS, STATUS_RANK, createWhatsAppConversationDeliveryService, ...defaultService };
