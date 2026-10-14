const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { createWhatsAppConversationAdminService } = require('../src/services/whatsappConversationAdminService');
const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');

function conversationClient(conversation) {
  const whereCalls = [];
  return {
    whereCalls,
    whatsAppConversationMessage: { findFirst: async () => null },
    whatsAppConversation: {
      findMany: async (args) => { whereCalls.push(args); return [conversation]; },
      findUnique: async ({ where }) => where.id === conversation.id ? conversation : null,
    },
  };
}

test('liste conversations with safe allowlisted filters and latest activity first', async () => {
  const conversation = { id: 2, phoneNumber: '+243812345678', messages: [], prospectFollowUps: [] };
  const client = conversationClient(conversation);
  const service = createWhatsAppConversationAdminService({ client });
  const result = await service.list('handoff');
  assert.equal(result.filter, 'handoff');
  assert.deepEqual(client.whereCalls[0].where, { controlState: 'HUMAN_TAKEOVER' });
  assert.deepEqual(client.whereCalls[0].orderBy, [{ lastMessageAt: 'desc' }, { id: 'desc' }]);
  await service.list('controlState');
  assert.deepEqual(client.whereCalls[1].where, {});
  await service.list('prospects');
  assert.deepEqual(client.whereCalls[2].where, { OR: [{ userId: null }, { user: { is: { enrollments: { none: {} } } } }] });
  await service.list('enrolled');
  assert.deepEqual(client.whereCalls[3].where, { user: { is: { enrollments: { some: {} } } } });
});

test('detail caps history and presents messages in chronological order', async () => {
  const conversation = { id: 9, messages: [{ id: 3 }, { id: 2 }, { id: 1 }], prospectFollowUps: [], consentEvents: [] };
  const service = createWhatsAppConversationAdminService({ client: conversationClient(conversation) });
  const result = await service.get('9');
  assert.deepEqual(result.messages.map((message) => message.id), [1, 2, 3]);
  await assert.rejects(service.get('9 OR 1=1'), { statusCode: 400 });
  await assert.rejects(service.get('10'), { statusCode: 404 });
});

test('admin conversation templates escape message text and expose no unescaped user body', () => {
  const detail = fs.readFileSync('views/admin/whatsapp/conversation.ejs', 'utf8');
  assert.match(detail, /<%= message\.body/);
  assert.doesNotMatch(detail, /<%-\s*message\.body/);
  assert.equal(ejs.render('<%= value %>', { value: '<script>alert(1)</script>' }), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const app = fs.readFileSync('src/app.js', 'utf8');
  assert.match(app, /app\.use\('\/admin\/whatsapp', requireAdmin, adminWhatsAppRoutes\)/);
  assert.match(app, /app\.use\(csrfProtection\.protect\)/);
});

test('takeover and pause cancel queued automation; opted-out state cannot be resumed', async () => {
  const row = { id: 4, controlState: 'BOT_ACTIVE', engineState: { step: 'welcome' } };
  const cancellations = [];
  const messages = [];
  const client = {
    whatsAppConversation: {
      findUnique: async ({ where }) => where.id === row.id ? { ...row } : null,
      updateMany: async ({ where, data }) => {
        if (where.id !== row.id || where.controlState.notIn.includes(row.controlState)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    whatsAppConversationMessage: { updateMany: async (query) => { messages.push(query); return { count: 1 }; } },
  };
  const service = createWhatsAppConversationService({ client, followUps: { cancelForConversation: async (...args) => cancellations.push(args) }, now: () => new Date('2026-10-09T10:00:00Z') });
  await service.takeOverConversation(4, 12);
  assert.equal(row.controlState, 'HUMAN_TAKEOVER');
  assert.equal(row.assignedAdvisorId, 12);
  assert.equal(cancellations[0][1], 'HUMAN_TAKEOVER');
  row.controlState = 'BOT_ACTIVE';
  await service.pauseAutomation(4);
  assert.equal(row.controlState, 'BOT_PAUSED');
  assert.equal(row.engineState.automationPaused, true);
  assert.equal(cancellations[1][1], 'AUTOMATION_PAUSED');
  row.controlState = 'OPTED_OUT';
  await assert.rejects(service.resumeAutomation(4), { code: 'WHATSAPP_AUTOMATION_REFUSED' });
  assert.equal(messages.length, 2);
});
