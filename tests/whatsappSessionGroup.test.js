const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhatsAppSessionGroupService, validateGroupInput } = require('../src/services/whatsappSessionGroupService');
const requireAdmin = require('../src/middlewares/requireAdmin');

function fixture({ phone = '+243812345678', sender = async () => ({ providerMessageId: 'wamid.test' }), now = () => new Date() } = {}) {
  const group = { id: 7, trainingSessionId: 4, name: 'Novembre', invitationLink: 'https://chat.whatsapp.com/abcdefghijk', status: 'ACTIVE', trainingSession: { id: 4, name: 'Session novembre', course: { title: 'Anglais' } } };
  const enrollment = { id: 13, status: 'PAYMENT_REQUIRED', user: { firstName: 'Aline', lastName: 'N.', phoneNumber: phone, whatsappNumber: null, whatsappPreference: { isEnabled: true, hasOptedIn: true, phoneNumber: phone } } };
  const invitation = { id: 21, groupId: 7, enrollmentId: 13, attempts: 0, status: 'PENDING', group, enrollment, updatedAt: new Date(), attemptsHistory: [] };
  const client = {
    whatsAppSessionGroup: { upsert: async ({ create, update }) => ({ ...group, ...create, ...update }), findUnique: async () => group },
    enrollment: { findMany: async () => [{ id: 13 }], findUnique: async () => ({ ...enrollment, trainingSession: { whatsAppGroup: group }, whatsAppSessionInvitation: invitation }) },
    whatsAppSessionInvitation: {
      upsert: async () => invitation,
      findUnique: async () => invitation,
      updateMany: async ({ where, data }) => {
        if (where.id && where.id !== invitation.id) return { count: 0 };
        if (typeof where.status === 'string' && where.status !== invitation.status) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(invitation.status)) return { count: 0 };
        if (where.attempts?.lt && invitation.attempts >= where.attempts.lt) return { count: 0 };
        if (where.updatedAt?.lt && invitation.updatedAt >= where.updatedAt.lt) return { count: 0 };
        const applied = { ...data };
        if (data.attempts?.increment) applied.attempts = invitation.attempts + data.attempts.increment;
        Object.assign(invitation, applied, { updatedAt: data.updatedAt || new Date() });
        return { count: 1 };
      },
      findMany: async ({ where }) => {
        const pendingIsApproved = invitation.status === 'PENDING'
          && (!where.OR?.[0]?.sendRequestedAt?.not || invitation.sendRequestedAt);
        const retryDue = invitation.status === 'FAILED' && invitation.lastResult === '429';
        const due = !where.updatedAt?.lte || invitation.updatedAt <= where.updatedAt.lte;
        return (pendingIsApproved || retryDue) && due ? [{ id: invitation.id }] : [];
      },
    },
    whatsAppSessionInvitationAttempt: {
      create: async ({ data }) => { const row = { id: invitation.attemptsHistory.length + 1, ...data }; invitation.attemptsHistory.push(row); return row; },
      findUnique: async ({ where }) => invitation.attemptsHistory.find(row => (where.providerMessageId && row.providerMessageId === where.providerMessageId) || (where.idempotencyKey && row.idempotencyKey === where.idempotencyKey)) || null,
      updateMany: async ({ where, data }) => {
        const row = invitation.attemptsHistory.find(item => (!where.id || item.id === where.id) && (!where.invitationId || item.invitationId === where.invitationId) && (!where.attemptNumber || item.attemptNumber === where.attemptNumber) && (!where.status || (typeof where.status === 'string' ? item.status === where.status : where.status.in.includes(item.status))));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  return { group, enrollment, invitation, client, service: createWhatsAppSessionGroupService({ client, sender, now, env: { WHATSAPP_ENABLED: 'true', WHATSAPP_SESSION_INVITE_TEMPLATE: 'nva_session_invite' } }) };
}

test('validates and saves a WhatsApp group association for a session', async () => {
  const { service, group } = fixture();
  assert.deepEqual(validateGroupInput(group), { name: group.name, invitationLink: group.invitationLink, status: 'ACTIVE' });
  assert.throws(() => validateGroupInput({ ...group, invitationLink: 'https://example.com' }), /lien d’invitation WhatsApp valide/);
  assert.equal((await service.saveGroup(4, group)).trainingSessionId, 4);
});

test('the existing admin guard rejects anonymous and non-admin requests', () => {
  let redirect;
  let forwarded;
  requireAdmin({ session: {} }, { redirect: value => { redirect = value; } }, error => { forwarded = error; });
  assert.equal(redirect, '/login');
  requireAdmin({ session: { user: { id: 8 } }, authenticatedUser: { role: 'STUDENT', isActive: true } }, {}, error => { forwarded = error; });
  assert.equal(forwarded.statusCode, 403);
});

test('reads only enrollments attached to the requested session', async () => {
  const setup = fixture();
  let query;
  setup.client.enrollment.findMany = async (args) => { query = args; return [{ id: 13 }]; };
  assert.deepEqual(await setup.service.listStudents(4), [{ id: 13 }]);
  assert.equal(query.where.trainingSessionId, 4);
  assert.deepEqual(query.where.status.in, ['TRIAL_ACTIVE', 'PLACEMENT_TEST_REQUIRED', 'PAYMENT_REQUIRED', 'CONFIRMED']);
});

test('prepares an enrollment for the existing worker without sending inline', async () => {
  const setup = fixture();
  let calls = 0;
  const queued = createWhatsAppSessionGroupService({ client: setup.client, sender: async () => { calls++; return { providerMessageId: 'wamid.123' }; }, env: { WHATSAPP_SESSION_INVITES_AUTOMATIC: 'true' } });
  assert.equal((await queued.prepareForEnrollment(13)).id, 21);
  assert.equal(calls, 0);
});

test('queues confirmed admin selections instead of calling Meta in the request', async () => {
  const setup = fixture();
  let sends = 0;
  setup.client.enrollment.findMany = async () => [{ id: 13 }];
  const queuedService = createWhatsAppSessionGroupService({ client: setup.client, sender: async () => { sends++; return { providerMessageId: 'wamid.123' }; }, env: { WHATSAPP_ENABLED: 'true' } });
  const results = await queuedService.sendSelected(4, ['13', '13', '999']);
  assert.deepEqual(results, [{ queued: true, invitationId: 21 }]);
  assert.ok(setup.invitation.sendRequestedAt instanceof Date);
  assert.equal(sends, 0);
});

test('the existing WhatsApp worker processes manually approved queue items with automation disabled', async () => {
  const setup = fixture();
  setup.invitation.sendRequestedAt = new Date();
  let sends = 0;
  const worker = createWhatsAppSessionGroupService({ client: setup.client, sender: async () => { sends++; return { providerMessageId: 'wamid.worker' }; }, env: { WHATSAPP_ENABLED: 'true', WHATSAPP_SESSION_INVITES_AUTOMATIC: 'false', WHATSAPP_SESSION_INVITE_TEMPLATE: 'nva_session_invite' } });
  const results = await worker.processPending();
  assert.equal(results[0].sent, true);
  assert.equal(setup.invitation.status, 'ACCEPTED');
  assert.equal(sends, 1);
});

test('does not prepare an invitation if the enrollment has no active session group', async () => {
  const setup = fixture();
  setup.client.enrollment.findUnique = async () => ({ id: 13, status: 'PAYMENT_REQUIRED', trainingSession: { whatsAppGroup: null } });
  let writes = 0;
  setup.client.whatsAppSessionInvitation.upsert = async () => { writes++; return {}; };
  assert.equal(await setup.service.prepareForEnrollment(13), null);
  assert.equal(writes, 0);
});

test('sends one approved-template invitation and records the provider result', async () => {
  let calls = 0;
  const { service, invitation } = fixture({ sender: async (payload) => { calls++; assert.equal(payload.templateParameters[3], 'https://chat.whatsapp.com/abcdefghijk'); return { providerMessageId: 'wamid.123' }; } });
  const result = await service.sendInvitation(21);
  assert.equal(result.sent, true);
  assert.equal(calls, 1);
  assert.equal(invitation.status, 'ACCEPTED');
  assert.equal(invitation.providerMessageId, 'wamid.123');
  assert.equal(invitation.attemptsHistory[0].status, 'ACCEPTED');
  assert.equal(invitation.attemptsHistory[0].resultCode, 'ACCEPTED_BY_META');
  await service.applyStatus({ id: 'wamid.123', status: 'delivered', biz_opaque_callback_data: invitation.attemptsHistory[0].idempotencyKey });
  assert.equal(invitation.status, 'DELIVERED');
  assert.equal(invitation.attemptsHistory[0].status, 'DELIVERED');
  assert.deepEqual(await service.sendInvitation(21), { skipped: true, reason: 'ALREADY_SENT' });
  assert.equal(calls, 1);
});

test('does not send without consent or a valid WhatsApp number', async () => {
  const noConsent = fixture();
  noConsent.enrollment.user.whatsappPreference.hasOptedIn = false;
  assert.equal((await noConsent.service.sendInvitation(21)).result, 'WHATSAPP_CONSENT_REQUIRED');
  const noNumber = fixture({ phone: 'bad-number' });
  assert.equal((await noNumber.service.sendInvitation(21)).result, 'INVALID_WHATSAPP_NUMBER');
});

test('retries a confirmed rate limit after a delay and never automatically retries an uncertain send', async () => {
  let clock = new Date('2026-11-22T00:00:00Z');
  let calls = 0;
  const temp = fixture({ now: () => clock, sender: async () => { calls++; if (calls === 1) throw Object.assign(new Error('temporary'), { retryable: true, acceptanceRejected: true, code: '429' }); return { providerMessageId: 'wamid.retry' }; } });
  const failed = await temp.service.sendInvitation(21);
  assert.equal(failed.failed, true);
  assert.equal(temp.invitation.status, 'FAILED');
  const worker = createWhatsAppSessionGroupService({ client: temp.client, now: () => clock, sender: async () => { calls++; return { providerMessageId: 'wamid.retry' }; }, env: { WHATSAPP_ENABLED: 'true', WHATSAPP_SESSION_INVITE_TEMPLATE: 'nva_session_invite' } });
  assert.equal((await worker.processPending()).length, 0);
  clock = new Date(clock.getTime() + 60_001);
  assert.equal((await worker.processPending())[0].sent, true);
  assert.equal(calls, 2);
  assert.deepEqual(temp.invitation.attemptsHistory.map(attempt => attempt.status), ['FAILED', 'ACCEPTED']);
  const uncertain = fixture({ sender: async () => { throw Object.assign(new Error('uncertain'), { uncertain: true }); } });
  assert.equal((await uncertain.service.sendInvitation(21)).uncertain, true);
  assert.deepEqual(await uncertain.service.sendInvitation(21), { skipped: true, reason: 'DELIVERY_UNCERTAIN' });
});

test('correlates delivery webhooks without claiming group membership', async () => {
  const { service, invitation } = fixture();
  invitation.providerMessageId = 'wamid.123';
  invitation.status = 'ACCEPTED';
  const status = await service.applyStatus({ id: 'wamid.123', status: 'delivered' }, { detailed: true });
  assert.equal(status.outcome, 'applied');
  assert.equal(invitation.status, 'DELIVERED');
  assert.equal(invitation.lastResult, 'DELIVERED');
  assert.equal(invitation.joinedAt, undefined);
});

test('does not let a mismatched provider message id overwrite the correlated invitation', async () => {
  const { service, invitation } = fixture();
  invitation.providerMessageId = 'wamid.original';
  invitation.idempotencyKey = 'nva-session-invite:21';
  const result = await service.applyStatus({ id: 'wamid.other', status: 'delivered', biz_opaque_callback_data: invitation.idempotencyKey }, { detailed: true });
  assert.equal(result.outcome, 'ignored');
  assert.equal(invitation.providerMessageId, 'wamid.original');
  assert.equal(invitation.status, 'PENDING');
});
