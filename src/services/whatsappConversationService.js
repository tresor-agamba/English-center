const prisma = require('../utils/prisma');
const { lockRecipients } = require('./whatsappSubmissionCoordinator');
const publicCourseService = require('./publicCourseService');
const registrationService = require('./registrationService');
const whatsappPreferences = require('./whatsappPreferenceService');
const prospectFollowUps = require('./whatsappProspectFollowUpService');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { createConversationEngine } = require('./whatsappConversationEngine');
const { normalizePhoneNumber, isValidWhatsAppPhoneNumber } = require('../utils/phoneNumber');

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_MESSAGE_BODY_LENGTH = 4000;

function messageTypeForProvider(type) {
  if (type === 'text') return 'TEXT';
  if (type === 'interactive') return 'INTERACTIVE';
  if (['image', 'audio', 'video', 'document', 'sticker'].includes(type)) return 'MEDIA';
  return 'SYSTEM';
}

function inboundText(message) {
  const body = message?.text?.body
    || message?.interactive?.button_reply?.title
    || message?.interactive?.list_reply?.title
    || '';
  return String(body).trim().slice(0, MAX_MESSAGE_BODY_LENGTH);
}

function providerDate(timestamp, fallback) {
  if (!/^\d+$/.test(String(timestamp || ''))) return fallback;
  const value = new Date(Number(timestamp) * 1000);
  return Number.isNaN(value.getTime()) ? fallback : value;
}

function stateForConversation(conversation) {
  const value = conversation.engineState && typeof conversation.engineState === 'object'
    ? conversation.engineState
    : {};
  if (conversation.controlState === 'OPTED_OUT') return { ...value, optedOut: true, automationPaused: true };
  if (['HUMAN_TAKEOVER', 'BOT_PAUSED', 'CLOSED'].includes(conversation.controlState)) {
    return { ...value, automationPaused: true };
  }
  return value;
}

function isUniqueConstraint(error) {
  return error?.code === 'P2002';
}

function createWhatsAppConversationService({
  client = prisma,
  catalog = publicCourseService,
  registration = registrationService,
  preferences = whatsappPreferences,
  followUps = prospectFollowUps,
  followUpConfig = () => getWhatsAppConfig(),
  publicAppUrl = process.env.PUBLIC_APP_URL || '',
  now = () => new Date(),
  engineFactory = createConversationEngine,
} = {}) {
  // One SQL transaction body shared by the historical wrapper and the inbox adapter.
  // No transaction is opened, retried or committed here.
  async function executeInboundTransaction(tx, input, { engineNow = now, processedNow = now } = {}) {
    const { message, providerMessageId, phoneNumber, receivedAt, body, providerTimestamp, processingStartedAt = receivedAt } = input;
    await lockRecipients(tx, [phoneNumber]);
    const userMatches = await tx.user.findMany({
      where: { OR: [{ phoneNumber }, { whatsappNumber: phoneNumber }] },
      select: { id: true },
      take: 2,
    });
    const linkedUserId = userMatches.length === 1 ? userMatches[0].id : null;
    const conversation = await tx.whatsAppConversation.upsert({
      where: { phoneNumber },
      create: { phoneNumber, userId: linkedUserId, controlState: 'BOT_ACTIVE' },
      update: {},
    });
    if (!conversation.userId && linkedUserId) {
      await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { userId: linkedUserId } });
      conversation.userId = linkedUserId;
    }
    const allowCommercialFollowUpConsent = linkedUserId
      ? !await tx.enrollment.findFirst({ where: { userId: linkedUserId }, select: { id: true } })
      : true;

    const inbound = await tx.whatsAppConversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'INBOUND',
        messageType: messageTypeForProvider(message.type),
        body: body || null,
        providerMessageId,
        providerTimestamp,
        receivedAt,
        processingStatus: 'PROCESSING',
        processingStartedAt,
        ...(message.type === 'interactive' ? { interactivePayload: {
          ...(message.interactive?.button_reply ? { button_reply: { title: body, id: require('./whatsappInteractive').interactionId(message) } } : {}),
          ...(message.interactive?.list_reply ? { list_reply: { title: body, id: require('./whatsappInteractive').interactionId(message) } } : {}),
        } } : {}),
      },
    });

    const engine = engineFactory({
      catalog: { listPublished: () => catalog.listPublished(tx) },
      registration: { listCoursesForPublicRegistration: () => registration.listCoursesForPublicRegistration(tx) },
      now: engineNow,
      whatsappConfig: followUpConfig,
      admissions: require('./whatsappAdmissionJourney').createAdmissionJourney({ database: tx, catalog: { listPublished: () => catalog.listPublished(tx) }, registration: { listCoursesForPublicRegistration: () => registration.listCoursesForPublicRegistration(tx) }, now: engineNow }),
      scenarios: require('./whatsappScenarioService').createScenarioService({ database: tx, now: engineNow }),
      chatbot: require('./whatsappChatbotService').createChatbotService({ database: tx,
        deferAI: process.env.NVA_CHATBOT_AI_ENABLED === 'true' }),
    });
    const result = await engine.handleMessage({
      text: body,
      phoneNumber,
      interactionId: message.type === 'interactive' ? require('./whatsappInteractive').interactionId(message) || 'unrecognized-interaction' : null,
      messageId: providerMessageId,
      state: stateForConversation(conversation),
      publicAppUrl,
      allowCommercialFollowUpConsent,
    });

    let controlState = conversation.controlState;
    for (const action of result.actions || []) {
      if (action.type === 'ADMISSION_REQUEST') {
        await require('./whatsappAdmissionService').recordConfirmed(tx, { conversationId: conversation.id, ...action, sourceMessageId: providerMessageId }, receivedAt);
      } else if (action.type === 'HUMAN_HANDOFF') {
        controlState = 'HUMAN_TAKEOVER';
        await tx.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { controlState, handoffAt: receivedAt },
        });
        await followUps.cancelForConversation(conversation.id, 'HUMAN_TAKEOVER', tx);
      } else if (action.type === 'RESUME_AUTOMATION') {
        controlState = 'BOT_ACTIVE';
        await tx.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { controlState, resumedAt: receivedAt, assignedAdvisorId: null },
        });
      } else if (action.type === 'OPT_OUT') {
        controlState = 'OPTED_OUT';
        await tx.whatsAppConversation.update({
          where: { id: conversation.id },
          data: { controlState, handoffAt: null, assignedAdvisorId: null },
        });
        const consentKey = `wa-consent:${providerMessageId}:COMMERCIAL_FOLLOW_UPS:REVOKED`;
        await tx.whatsAppCommercialConsentEvent.create({
          data: {
            conversationId: conversation.id,
            scope: 'COMMERCIAL_FOLLOW_UPS',
            decision: 'REVOKED',
            source: 'WHATSAPP_INBOUND',
            evidenceMessageId: inbound.id,
            evidenceProviderMessageId: providerMessageId,
            occurredAt: providerTimestamp || receivedAt,
            deduplicationKey: consentKey,
          },
        });
        await followUps.cancelForConversation(conversation.id, 'CONSENT_WITHDRAWN', tx);
        const preferenceMatches = await tx.whatsAppPreference.findMany({
          where: { phoneNumber, hasOptedIn: true },
          select: { userId: true },
          take: 2,
        });
        const userIds = new Set(preferenceMatches.map((row) => row.userId));
        if (conversation.userId) userIds.add(conversation.userId);
        if (userIds.size === 1) await preferences.recordWhatsAppOptOut([...userIds][0], tx);
      } else if (action.type === 'COMMERCIAL_CONSENT_GRANT') {
        const consentEvent = await tx.whatsAppCommercialConsentEvent.create({
          data: {
            conversationId: conversation.id,
            scope: 'COMMERCIAL_FOLLOW_UPS',
            decision: 'GRANTED',
            source: 'WHATSAPP_INBOUND',
            evidenceMessageId: inbound.id,
            evidenceProviderMessageId: providerMessageId,
            noticeVersion: action.noticeVersion,
            occurredAt: providerTimestamp || receivedAt,
            deduplicationKey: `wa-consent:${providerMessageId}:COMMERCIAL_FOLLOW_UPS:GRANTED`,
          },
        });
        const config = followUpConfig();
        if (config.prospectFollowUp24hTemplate && config.prospectFollowUp72hTemplate) {
          await followUps.schedule({ conversationId: conversation.id, consentEventId: consentEvent.id, consentedAt: receivedAt }, tx);
        }
      }
    }

    const engineState = result.state && typeof result.state === 'object' ? result.state : {};
    if (controlState !== conversation.controlState && ['HUMAN_TAKEOVER', 'OPTED_OUT', 'CLOSED', 'BOT_PAUSED'].includes(controlState)) {
      await tx.whatsAppConversationMessage.updateMany({
        where: { conversationId: conversation.id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' },
        data: { deliveryStatus: 'CANCELLED', failureCode: 'AUTOMATION_NOT_ACTIVE' },
      });
    }
    const updated = await tx.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { controlState, engineState, lastMessageAt: receivedAt },
    });

    let queuedResponses = 0;
    const handoffAck = (result.actions || []).some(action => action.type === 'HUMAN_HANDOFF');
    if (result.text && (controlState === 'BOT_ACTIVE' || (handoffAck && controlState === 'HUMAN_TAKEOVER'))) {
      await tx.whatsAppConversationMessage.create({
        data: {
          conversationId: conversation.id,
          direction: 'OUTBOUND',
          messageType: handoffAck ? 'SYSTEM' : result.interactive ? 'INTERACTIVE' : 'TEXT',
          ...(result.interactive ? { interactivePayload: result.interactive } : {}),
          body: result.text.slice(0, MAX_MESSAGE_BODY_LENGTH),
          idempotencyKey: `${handoffAck ? 'wa-handoff' : 'wa-reply'}:${providerMessageId}:0`,
          deliveryStatus: 'QUEUED',
          ...(result.deferredAI ? { failureCode: 'AI_PENDING' } : {}),
          receivedAt,
        },
      });
      queuedResponses = 1;
    }

    await tx.whatsAppConversationMessage.update({
      where: { id: inbound.id },
      data: { processingStatus: 'PROCESSED', processedAt: processedNow() },
    });

    return { ignored: false, duplicate: false, conversationId: updated.id, queuedResponses };
  }

  async function processInboundMessage(message) {
    const providerMessageId = String(message?.id || '').trim();
    const phoneNumber = normalizePhoneNumber(`+${String(message?.from || '').replace(/\D/g, '')}`);
    if (!providerMessageId || !isValidWhatsAppPhoneNumber(phoneNumber)) return { ignored: true, duplicate: false, queuedResponses: 0 };
    const receivedAt = now();
    const body = inboundText(message);
    // Missing timestamps must not manufacture a new customer-service window.
    const providerTime = providerDate(message.timestamp, null);
    const providerTimestamp = providerTime && providerTime <= receivedAt ? providerTime : null;

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        const result = await client.$transaction(tx => executeInboundTransaction(tx,
          { message, providerMessageId, phoneNumber, receivedAt, body, providerTimestamp }), { isolationLevel: 'Serializable' });
        // SQL has committed before any external request. A failed completion leaves a safe fallback.
        if (process.env.NVA_CHATBOT_AI_ENABLED === 'true' && result.queuedResponses) {
          try { await require('./whatsappChatbotAICompletionService').createAICompletionService({ database: client }).completeReply('wa-reply:' + providerMessageId + ':0'); } catch { /* Never retry ingress after its commit. */ }
        }
        return result;
      } catch (error) {
        if (isUniqueConstraint(error)) {
          const existing = await client.whatsAppConversationMessage.findUnique({
            where: { providerMessageId },
            select: { id: true },
          });
          if (existing) return { ignored: false, duplicate: true, queuedResponses: 0 };
        }
        if (error?.code === 'P2034' && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
        throw error;
      }
    }
    return { ignored: false, duplicate: false, queuedResponses: 0 };
  }

  // Explicit tx supplied by the inbox unit of work. Never use the root client.
  async function processInboundMessageInTransaction(tx, message, { firstReceivedAt, processedAt } = {}) {
    const invalid = () => { throw Object.assign(new Error('Invalid inbox transaction context.'), { code: 'META_INBOX_INVALID_TRANSACTION_CONTEXT' }); };
    if (!tx || typeof tx.$transaction === 'function' || !tx.whatsAppConversationMessage?.findUnique) invalid();
    if (!(firstReceivedAt instanceof Date) || !(processedAt instanceof Date) || !Number.isFinite(+firstReceivedAt)
      || !Number.isFinite(+processedAt) || processedAt < firstReceivedAt) invalid();
    const receivedAt = new Date(firstReceivedAt), finishedAt = new Date(processedAt);
    const providerMessageId = String(message?.id || '').trim();
    const phoneNumber = normalizePhoneNumber('+' + String(message?.from || '').replace(/\D/g, ''));
    if (!providerMessageId || !isValidWhatsAppPhoneNumber(phoneNumber)) return { ignored: true, duplicate: false, queuedResponses: 0 };
    const existing = await tx.whatsAppConversationMessage.findUnique({ where: { providerMessageId } });
    if (existing) {
      const conversation = await tx.whatsAppConversation.findUnique({ where: { id: existing.conversationId } });
      if (existing.direction !== 'INBOUND' || conversation?.phoneNumber !== phoneNumber || existing.body !== (inboundText(message) || null)
        || ((existing.interactivePayload?.button_reply?.id || existing.interactivePayload?.list_reply?.id || null) !== require('./whatsappInteractive').interactionId(message))) {
        throw Object.assign(new Error('Conflicting native message identity.'), { code: 'META_INBOX_NATIVE_IDENTIFIER_CONFLICT' });
      }
      return { ignored: false, duplicate: true, queuedResponses: 0 };
    }
    const providerTime = providerDate(message.timestamp, null);
    return executeInboundTransaction(tx, { message, providerMessageId, phoneNumber, receivedAt, body: inboundText(message),
      providerTimestamp: providerTime && providerTime <= receivedAt ? providerTime : null, processingStartedAt: finishedAt },
      { engineNow: () => new Date(receivedAt), processedNow: () => new Date(finishedAt) });
  }

  async function takeOverConversation(conversationId, advisorId) {
    const id = Number(conversationId);
    const update = await client.whatsAppConversation.updateMany({
      where: { id, controlState: { notIn: ['OPTED_OUT', 'CLOSED'] } },
      data: { controlState: 'HUMAN_TAKEOVER', assignedAdvisorId: Number(advisorId), handoffAt: now() },
    });
    if (!update.count) {
      const exists = await client.whatsAppConversation.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return null;
      const error = new Error('Cette conversation ne peut pas être prise en charge automatiquement.');
      error.code = 'WHATSAPP_AUTOMATION_REFUSED';
      error.statusCode = 409;
      throw error;
    }
    const updated = await client.whatsAppConversation.findUnique({ where: { id } });
    await client.whatsAppConversationMessage.updateMany({ where: { conversationId: updated.id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' }, data: { deliveryStatus: 'CANCELLED', failureCode: 'AUTOMATION_NOT_ACTIVE' } });
    await followUps.cancelForConversation(updated.id, 'HUMAN_TAKEOVER');
    return updated;
  }

  async function pauseAutomation(conversationId) {
    const id = Number(conversationId);
    const conversation = await client.whatsAppConversation.findUnique({ where: { id } });
    if (!conversation) return null;
    const update = await client.whatsAppConversation.updateMany({
      where: { id, controlState: { notIn: ['OPTED_OUT', 'CLOSED'] } },
      data: { controlState: 'BOT_PAUSED', engineState: { ...stateForConversation(conversation), automationPaused: true } },
    });
    if (!update.count) {
      const error = new Error('Cette conversation ne peut pas être suspendue automatiquement.');
      error.code = 'WHATSAPP_AUTOMATION_REFUSED';
      error.statusCode = 409;
      throw error;
    }
    const updated = await client.whatsAppConversation.findUnique({ where: { id } });
    await client.whatsAppConversationMessage.updateMany({ where: { conversationId: updated.id, direction: 'OUTBOUND', deliveryStatus: 'QUEUED' }, data: { deliveryStatus: 'CANCELLED', failureCode: 'AUTOMATION_NOT_ACTIVE' } });
    await followUps.cancelForConversation(updated.id, 'AUTOMATION_PAUSED');
    return updated;
  }

  async function resumeAutomation(conversationId) {
    const conversation = await client.whatsAppConversation.findUnique({ where: { id: Number(conversationId) } });
    if (!conversation) return null;
    if (conversation.controlState === 'OPTED_OUT' || conversation.controlState === 'CLOSED') {
      const error = new Error('Cette conversation ne peut pas reprendre automatiquement.');
      error.code = 'WHATSAPP_AUTOMATION_REFUSED';
      error.statusCode = 409;
      throw error;
    }
    const prior = stateForConversation(conversation);
    const update = await client.whatsAppConversation.updateMany({
      where: { id: conversation.id, controlState: { notIn: ['OPTED_OUT', 'CLOSED'] } },
      data: {
        controlState: 'BOT_ACTIVE',
        assignedAdvisorId: null,
        resumedAt: now(),
        engineState: { ...prior, automationPaused: false },
      },
    });
    if (!update.count) {
      const error = new Error('Cette conversation ne peut pas reprendre automatiquement.');
      error.code = 'WHATSAPP_AUTOMATION_REFUSED';
      error.statusCode = 409;
      throw error;
    }
    return client.whatsAppConversation.findUnique({ where: { id: conversation.id } });
  }

  return { processInboundMessage, processInboundMessageInTransaction, takeOverConversation, pauseAutomation, resumeAutomation };
}

const defaultService = createWhatsAppConversationService();
module.exports = {
  MAX_TRANSACTION_ATTEMPTS,
  MAX_MESSAGE_BODY_LENGTH,
  messageTypeForProvider,
  inboundText,
  providerDate,
  stateForConversation,
  createWhatsAppConversationService,
  ...defaultService,
};
