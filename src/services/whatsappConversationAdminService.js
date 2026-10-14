const prisma = require('../utils/prisma');
const { getServiceWindow } = require('./whatsappServiceWindow');

const FILTERS = ['all', 'prospects', 'enrolled', 'handoff', 'opted-out'];
const LIST_TAKE = 100;
const MESSAGE_TAKE = 100;

function parseConversationId(value) {
  const text = String(value ?? '');
  if (!/^\d+$/.test(text) || Number(text) < 1 || !Number.isSafeInteger(Number(text))) {
    const error = new Error('Identifiant de conversation invalide.');
    error.statusCode = 400;
    throw error;
  }
  return Number(text);
}

function createWhatsAppConversationAdminService({ client = prisma } = {}) {
  async function list(filter = 'all') {
    const selectedFilter = FILTERS.includes(filter) ? filter : 'all';
    const where = {
      ...(selectedFilter === 'prospects' ? { OR: [{ userId: null }, { user: { is: { enrollments: { none: {} } } } }] } : {}),
      ...(selectedFilter === 'enrolled' ? { user: { is: { enrollments: { some: {} } } } } : {}),
      ...(selectedFilter === 'handoff' ? { controlState: 'HUMAN_TAKEOVER' } : {}),
      ...(selectedFilter === 'opted-out' ? { controlState: 'OPTED_OUT' } : {}),
    };
    const conversations = await client.whatsAppConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: LIST_TAKE,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, enrollments: { select: { id: true }, take: 1 } } },
        assignedAdvisor: { select: { id: true, firstName: true, lastName: true } },
        messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { body: true, direction: true, createdAt: true, deliveryStatus: true } },
        prospectFollowUps: { orderBy: [{ sequenceHours: 'asc' }, { id: 'asc' }], select: { id: true, sequenceHours: true, status: true, scheduledFor: true, attempts: true } },
      },
    });
    return { filter: selectedFilter, conversations };
  }

  async function get(id, beforeId) {
    const conversationId = parseConversationId(id);
    const cursor = beforeId == null || beforeId === '' ? null : parseConversationId(beforeId);
    const conversation = await client.whatsAppConversation.findUnique({
      where: { id: conversationId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, enrollments: { select: { id: true }, take: 1 } } },
        assignedAdvisor: { select: { id: true, firstName: true, lastName: true } },
        messages: { ...(cursor ? { where: { id: { lt: cursor } } } : {}), orderBy: [{ id: 'desc' }], take: MESSAGE_TAKE, include: { sender: { select: { id: true, firstName: true, lastName: true } } } },
        prospectFollowUps: { orderBy: [{ sequenceHours: 'asc' }, { id: 'asc' }] },
        consentEvents: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 10 },
      },
    });
    if (!conversation) {
      const error = new Error('Conversation introuvable.');
      error.statusCode = 404;
      throw error;
    }
    const serviceWindow = await getServiceWindow(client, conversationId);
    return { ...conversation, serviceWindow, messages: [...conversation.messages].reverse(),
      olderMessagesCursor: conversation.messages.length === MESSAGE_TAKE ? conversation.messages.at(-1).id : null };
  }

  return { list, get, parseConversationId };
}

const defaultService = createWhatsAppConversationAdminService();
module.exports = { FILTERS, LIST_TAKE, MESSAGE_TAKE, parseConversationId, createWhatsAppConversationAdminService, ...defaultService };
