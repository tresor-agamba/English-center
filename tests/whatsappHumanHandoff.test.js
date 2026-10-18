const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const ejs = require('ejs');
const { createWhatsAppHumanHandoffService } = require('../src/services/whatsappHumanHandoffService');
const { createWhatsAppConversationDeliveryService } = require('../src/services/whatsappConversationDeliveryService');

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('not' in value && row[key] === value.not) return false;
      if ('lt' in value && !(row[key] < value.lt)) return false;
      if ('lte' in value && !(row[key] !== null && row[key] <= value.lte)) return false;
      return true;
    }
    return row[key] === value;
  });
}
function harness({ state = 'HUMAN_TAKEOVER', owner = 1, age = 60_000, enabled = true, sender } = {}) {
  let now = new Date('2026-10-14T12:00:00Z');
  const conversation = { id: 7, controlState: state, assignedAdvisorId: owner, phoneNumber: '+243812345678',
    engineState: { selectedCourseId: 11, qualification: { objective: 'study' }, automationPaused: state !== 'BOT_ACTIVE' }, lastMessageAt: now };
  const users = [{ id: 1, role: 'ADMIN', isActive: true, mustChangePassword: false }, { id: 2, role: 'ADMIN', isActive: true, mustChangePassword: false }, { id: 3, role: 'STUDENT', isActive: true }];
  const rows = []; const audits = []; let sends = 0; let tail = Promise.resolve();
  const client = {
    user: { findUnique: async ({ where }) => structuredClone(users.find(user => user.id === where.id) || null) },
    whatsAppConversation: {
      findUnique: async ({ where }) => where.id === 7 ? structuredClone(conversation) : null,
      updateMany: async ({ where, data }) => { if (!matches(conversation, where)) return { count: 0 }; Object.assign(conversation, data); return { count: 1 }; },
    },
    whatsAppProspectFollowUp: { updateMany: async () => ({ count: 0 }) },
    whatsAppConversationMessage: {
      findFirst: async () => age === null ? null : { providerTimestamp: new Date(now.getTime() - age) },
      findUnique: async ({ where }) => { const row = rows.find(row => matches(row, where)); return row ? { ...structuredClone(row), conversation: structuredClone(conversation) } : null; },
      findMany: async ({ where }) => rows.filter(row => matches(row, where)).map(row => ({ id: row.id })),
      updateMany: async ({ where, data }) => {
        const found = rows.filter(row => matches(row, where));
        for (const row of found) { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value; row.updatedAt = data.updatedAt || now; }
        return { count: found.length };
      },
      create: async ({ data }) => {
        const validInbound = data.direction === 'INBOUND' && data.processingStatus != null && data.deliveryStatus == null;
        const validOutbound = data.direction === 'OUTBOUND' && data.processingStatus == null && data.deliveryStatus != null;
        assert.ok(validInbound || validOutbound, 'Message must satisfy the PostgreSQL status/direction constraint');
        if (rows.some(row => row.idempotencyKey === data.idempotencyKey)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: rows.length + 1, attempts: 0, failureCode: null, providerMessageId: null, senderUserId: null, createdAt: now, updatedAt: now, ...data }; rows.push(row); return structuredClone(row);
      },
    },
    $transaction: async work => {
      const pending = tail.then(async () => {
        const snapshot = structuredClone({ conversation, rows });
        try { return await work(client); }
        catch (error) { Object.assign(conversation, snapshot.conversation); rows.splice(0, rows.length, ...snapshot.rows); throw error; }
      });
      tail = pending.catch(() => {}); return pending;
    },
  };
  const configProvider = () => ({ enabled, maxAttempts: 3, batchSize: 10 });
  const human = createWhatsAppHumanHandoffService({ client, configProvider, now: () => now, audit: (action, data) => audits.push({ action, ...data }) });
  const delivery = createWhatsAppConversationDeliveryService({ client, configProvider, now: () => now,
    sender: async (...args) => { sends += 1; return sender ? sender(...args) : { providerMessageId: 'wamid.test' }; } });
  return { human, delivery, client, conversation, rows, users, audits, sends: () => sends,
    queue: (body = 'Bonjour', key = crypto.randomUUID(), actor = 1) => human.queueManualReply(7, actor, body, key),
    advance: ms => { now = new Date(now.getTime() + ms); },
  };
}
test('authorized manual response records author and history and only queues the send', async () => {
  const h = harness(); const result = await h.queue();
  assert.equal(h.rows.length, 1); assert.equal(result.message.senderUserId, 1); assert.equal(result.message.deliveryStatus, 'QUEUED');
  assert.equal(h.sends(), 0); assert.equal(h.audits[0].messageId, result.message.id);
  assert.equal(JSON.stringify(h.audits).includes('Bonjour'), false);
  assert.deepEqual(await h.delivery.processPending(), [{ accepted: true }]); assert.equal(h.sends(), 1);
});
test('unauthorized, inactive and password-change actors cannot queue', async () => {
  const h = harness(); await assert.rejects(h.queue('test', crypto.randomUUID(), 3), { statusCode: 403 });
  h.users[0].isActive = false; await assert.rejects(h.queue(), { statusCode: 403 });
  h.users[0].isActive = true; h.users[0].mustChangePassword = true; await assert.rejects(h.queue(), { statusCode: 403 });
  assert.equal(h.rows.length, 0);
});
for (const [name, body] of [['empty', ''], ['whitespace', '   '], ['too long', 'x'.repeat(4001)], ['non-text', {}]]) {
  test(`invalid manual message (${name}) is refused without persistence`, async () => {
    const h = harness(); await assert.rejects(h.queue(body), { statusCode: 400 }); assert.equal(h.rows.length, 0);
  });
}
test('expired or missing service window prevents queueing', async () => {
  for (const age of [24 * 3600_000, 25 * 3600_000, null, -1000]) {
    const h = harness({ age }); await assert.rejects(h.queue(), { statusCode: 409 }); assert.equal(h.rows.length, 0);
  }
});
test('window is rechecked by the worker after queueing', async () => {
  const h = harness({ age: 23 * 3600_000 }); await h.queue();
  // This mock holds provider age relative to clock; replace with a fixed provider time.
  h.client.whatsAppConversationMessage.findFirst = async () => ({ providerTimestamp: new Date('2026-10-13T13:00:00Z') });
  h.advance(2 * 3600_000); await h.delivery.processPending();
  assert.equal(h.rows[0].deliveryStatus, 'FAILED'); assert.equal(h.rows[0].failureCode, 'CUSTOMER_SERVICE_WINDOW_EXPIRED'); assert.equal(h.sends(), 0);
});
test('window expiring during administrator preflight prevents actual transmission', async () => {
  const h = harness({ age: 24 * 3600_000 - 1000 }); await h.queue();
  const original = h.client.user.findUnique;
  h.client.user.findUnique = async args => { const author = await original(args); h.advance(2000); return author; };
  await h.delivery.processPending(); assert.equal(h.sends(), 0); assert.equal(h.rows[0].failureCode, 'CUSTOMER_SERVICE_WINDOW_EXPIRED');
});
test('duplicate form submits produce one history message and one network attempt', async () => {
  const h = harness(); const key = crypto.randomUUID();
  const results = await Promise.all([h.queue('Bonjour', key), h.queue('Bonjour', key)]);
  assert.equal(h.rows.length, 1); assert.equal(results.filter(result => result.duplicate).length, 1);
  await Promise.all([h.delivery.processPending(), h.delivery.processPending()]); assert.equal(h.sends(), 1); assert.equal(h.rows[0].attempts, 1);
  await assert.rejects(h.queue('Changed body', key), { statusCode: 409 });
});
test('two administrators cannot steal an assigned conversation', async () => {
  const h = harness({ state: 'BOT_ACTIVE', owner: null });
  const results = await Promise.allSettled([h.human.takeOver(7, 1), h.human.takeOver(7, 2)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.conversation.controlState, 'HUMAN_TAKEOVER'); assert.equal(h.rows.length, 1);
  await assert.rejects(h.queue('Other admin', crypto.randomUUID(), h.conversation.assignedAdvisorId === 1 ? 2 : 1), { statusCode: 409 });
});
test('return to bot preserves memory, cancels pending manual replies and does not revive history', async () => {
  const h = harness(); await h.queue(); await h.human.resume(7, 1);
  assert.equal(h.conversation.controlState, 'BOT_ACTIVE'); assert.equal(h.conversation.assignedAdvisorId, null);
  assert.equal(h.conversation.engineState.selectedCourseId, 11); assert.equal(h.conversation.engineState.automationPaused, false);
  assert.equal(h.rows[0].deliveryStatus, 'CANCELLED'); await h.delivery.processPending(); assert.equal(h.sends(), 0);
  assert.equal(h.rows[1].messageType, 'SYSTEM'); assert.equal(h.rows[1].senderUserId, 1); assert.equal(h.rows[1].deliveryStatus, 'CANCELLED');
});

for (const [action, state, owner, target] of [
  ['takeOver', 'BOT_ACTIVE', null, 'HUMAN_TAKEOVER'],
  ['pause', 'BOT_ACTIVE', null, 'BOT_PAUSED'],
  ['resume', 'HUMAN_TAKEOVER', 1, 'BOT_ACTIVE'],
]) {
  test(`${action} records an internal SYSTEM event satisfying the SQL constraint without sending`, async () => {
    const h = harness({ state, owner });
    await h.human[action](7, 1);
    assert.equal(h.conversation.controlState, target);
    assert.equal(h.rows.length, 1);
    const event = h.rows[0];
    assert.equal(event.direction, 'OUTBOUND');
    assert.equal(event.messageType, 'SYSTEM');
    assert.equal(event.senderUserId, 1);
    assert.match(event.idempotencyKey, /^wa-control:/);
    assert.equal(event.processingStatus ?? null, null);
    assert.equal(event.deliveryStatus, 'CANCELLED');
    assert.equal(event.providerMessageId, null);
    assert.equal(event.attempts, 0);
    assert.equal(h.audits[0].messageId, event.id);
    assert.deepEqual(await h.delivery.sendMessage(event.id), { skipped: true });
    assert.deepEqual(await h.delivery.processPending(), []);
    await h.human[action](7, 1);
    assert.equal(h.rows.length, 1);
    assert.equal(h.audits.length, 1);
    assert.equal(event.deliveryStatus, 'CANCELLED');
    assert.equal(h.sends(), 0);
  });
}
test('STOP blocks replies and takeover/resume without altering consent', async () => {
  const h = harness({ state: 'OPTED_OUT' }); h.conversation.engineState.optedOut = true;
  await assert.rejects(h.queue(), { statusCode: 409 }); await assert.rejects(h.human.takeOver(7, 1), { statusCode: 409 });
  await assert.rejects(h.human.resume(7, 1), { statusCode: 409 }); assert.equal(h.rows.length, 0);
  assert.equal(h.conversation.engineState.optedOut, true);
});
test('acknowledgement exception allows one handoff message, not an ordinary bot response', async () => {
  const h = harness({ owner: null });
  await h.client.whatsAppConversationMessage.create({ data: { conversationId: 7, direction: 'OUTBOUND', messageType: 'SYSTEM', body: 'Transfert', idempotencyKey: 'wa-handoff:incoming-1:0', deliveryStatus: 'QUEUED' } });
  await h.client.whatsAppConversationMessage.create({ data: { conversationId: 7, direction: 'OUTBOUND', messageType: 'TEXT', body: 'Ordinary', idempotencyKey: 'wa-reply:incoming-2:0', deliveryStatus: 'QUEUED' } });
  await h.delivery.processPending(); assert.equal(h.sends(), 1); assert.equal(h.rows[0].deliveryStatus, 'ACCEPTED'); assert.equal(h.rows[1].deliveryStatus, 'CANCELLED');
  await h.delivery.processPending(); assert.equal(h.sends(), 1);
});
test('acknowledgement is blocked outside service window and after STOP', async () => {
  for (const options of [{ age: 25 * 3600_000 }, { state: 'OPTED_OUT' }]) {
    const h = harness(options);
    await h.client.whatsAppConversationMessage.create({ data: { conversationId: 7, direction: 'OUTBOUND', messageType: 'SYSTEM', body: 'Transfert', idempotencyKey: 'wa-handoff:incoming-1:0', deliveryStatus: 'QUEUED' } });
    await h.delivery.processPending(); assert.equal(h.sends(), 0);
  }
});
test('manual permanent rejection remains terminal', async () => {
  const h = harness({ sender: async () => { throw Object.assign(new Error('Rejected'), { code: '131026', retryable: false, uncertain: false }); } });
  await h.queue(); await h.delivery.processPending(); await h.delivery.processPending();
  assert.equal(h.rows[0].deliveryStatus, 'FAILED'); assert.equal(h.rows[0].attempts, 1); assert.equal(h.sends(), 1);
});
test('manual uncertain result never resends and can be reconciled by callback', async () => {
  const h = harness({ sender: async () => { throw Object.assign(new Error('Timeout'), { code: 'DELIVERY_UNCERTAIN', uncertain: true }); } });
  await h.queue(); await h.delivery.processPending(); await h.delivery.processPending();
  assert.equal(h.rows[0].failureCode, 'DELIVERY_UNCERTAIN'); assert.equal(h.sends(), 1);
  await h.delivery.applyStatus({ id: 'wamid.late', status: 'delivered', biz_opaque_callback_data: h.rows[0].idempotencyKey });
  assert.equal(h.rows[0].deliveryStatus, 'DELIVERED'); assert.equal(h.rows[0].attempts, 1);
});
test('worker rechecks administrator privileges and ownership', async () => {
  for (const kind of ['inactive', 'different-owner']) {
    const h = harness(); await h.queue();
    if (kind === 'inactive') h.users[0].isActive = false; else h.conversation.assignedAdvisorId = 2;
    await h.delivery.processPending(); assert.equal(h.rows[0].deliveryStatus, 'CANCELLED'); assert.equal(h.sends(), 0);
  }
});
test('manual service refuses disabled channel and invalid form identifier', async () => {
  const h = harness({ enabled: false }); await assert.rejects(h.queue(), { statusCode: 409 });
  await assert.rejects(h.queue('Bonjour', 'invalid'), { statusCode: 400 }); assert.equal(h.rows.length, 0);
});
test('conversation view compiles and exposes escaped manual fields with CSRF', () => {
  const source = fs.readFileSync('views/admin/whatsapp/conversation.ejs', 'utf8'); ejs.compile(source);
  assert.match(source, /csrfField\(\)/); assert.match(source, /<%= messageBody %>/); assert.match(source, /name="submissionId"/);
});
test('deleted author never turns a manual queued message into an automatic bot reply', async () => {
  const h = harness(); await h.queue(); h.rows[0].senderUserId = null;
  h.conversation.controlState = 'BOT_ACTIVE'; h.conversation.assignedAdvisorId = null;
  await h.delivery.processPending(); assert.equal(h.sends(), 0); assert.equal(h.rows[0].deliveryStatus, 'CANCELLED');
});
test('conversation body renders history, window and escaped manual form without partial dependencies', () => {
  const source = fs.readFileSync('views/admin/whatsapp/conversation.ejs', 'utf8').replace(/<%- include\([^\n]+?\) %>/g, '');
  const at = new Date('2026-10-14T12:00:00Z');
  const html = ejs.render(source, { conversation: { id: 7, phoneNumber: '+243812345678', controlState: 'HUMAN_TAKEOVER', assignedAdvisorId: 1,
    lastMessageAt: at, serviceWindow: { open: true, expiresAt: at }, messages: [
      { id: 1, createdAt: at, direction: 'INBOUND', body: '<script>attack</script>', messageType: 'TEXT' },
      { id: 2, createdAt: at, direction: 'OUTBOUND', body: 'Control event', messageType: 'SYSTEM', deliveryStatus: 'CANCELLED', sender: { firstName: 'Test', lastName: 'Advisor' } },
      { id: 3, createdAt: at, direction: 'OUTBOUND', body: 'Manual reply', messageType: 'TEXT', deliveryStatus: 'QUEUED', sender: { firstName: 'Test', lastName: 'Advisor' } },
    ],
    prospectFollowUps: [], consentEvents: [] }, title: 'Conversation', currentAdminId: 1, whatsappEnabled: true, queryAction: '',
    manualError: '', messageBody: '</textarea><script>attack</script>', submissionId: crypto.randomUUID(), maxManualLength: 4000, csrfField: () => '<input name="_csrf" value="test">', maskPhoneNumber: value => value });
  assert.match(html, /Fenêtre de service ouverte/); assert.match(html, /name="message"/);
  assert.match(html, /\+243812345678/); assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
  assert.equal((html.match(/Action administrative/g) || []).length, 1);
  assert.equal((html.match(/Réponse manuelle/g) || []).length, 1);
});
