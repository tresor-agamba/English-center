const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const cloudApi = require('../src/services/whatsappCloudApiService');

function makeClient({ now, controlState = 'BOT_ACTIVE', consentDecision = 'GRANTED', enrolled = false } = {}) {
  const consent = { id: 5, conversationId: 2, scope: 'COMMERCIAL_FOLLOW_UPS', decision: consentDecision, occurredAt: new Date('2026-10-01T00:00:00Z') };
  const conversation = { id: 2, phoneNumber: '+243812345678', controlState };
  const rows = [];
  let isEnrolled = enrolled;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'status' && value?.in) return value.in.includes(row.status);
    if (key === 'status' && typeof value === 'string') return row.status === value;
    if (key === 'scheduledFor' && value?.lte) return row.scheduledFor <= value.lte;
    if (key === 'updatedAt' && value?.lt) return row.updatedAt < value.lt;
    if (key === 'attempts' && value?.lt != null) return row.attempts < value.lt;
    if (key === 'id') return row.id === value;
    return row[key] === value;
  });
  const apply = (row, data) => { for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value; };
  const client = {
    rows,
    whatsAppProspectFollowUp: {
      upsert: async ({ where, create }) => {
        let row = rows.find((item) => item.deduplicationKey === where.deduplicationKey);
        if (!row) { row = { id: rows.length + 1, status: 'PENDING', attempts: 0, providerMessageId: null, failureCode: null, updatedAt: now(), conversation, consentEvent: consent, ...create }; rows.push(row); }
        return row;
      },
      updateMany: async ({ where, data }) => { const found = rows.filter((row) => matches(row, where)); found.forEach((row) => apply(row, data)); return { count: found.length }; },
      findUnique: async ({ where }) => rows.find((row) => where.id != null ? row.id === where.id : where.providerMessageId ? row.providerMessageId === where.providerMessageId : row.deduplicationKey === where.deduplicationKey) || null,
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map((row) => ({ id: row.id })),
      update: async ({ where, data }) => { const row = rows.find((item) => item.id === where.id); apply(row, data); return row; },
    },
    whatsAppCommercialConsentEvent: { findFirst: async () => consent },
    whatsAppConversation: { findUnique: async () => conversation },
    user: { findMany: async () => isEnrolled ? [{ id: 10 }] : [] },
    enrollment: { findFirst: async () => isEnrolled ? { id: 11 } : null },
  };
  return { client, rows, consent, conversation, setEnrolled: (value) => { isEnrolled = value; } };
}

function configProvider() {
  return { enabled: true, fakeMode: false, maxAttempts: 3, batchSize: 10, prospectFollowUp24hTemplate: 'nva_follow_up_24h', prospectFollowUp72hTemplate: 'nva_follow_up_72h' };
}

test('planifie une seule relance à 24 h et une seule à 72 h pour une preuve de consentement', async () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const { client, rows } = makeClient({ now: () => now });
  const service = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => now });
  const input = { conversationId: 2, consentEventId: 5, consentedAt: now };
  await service.schedule(input);
  await service.schedule(input);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.sequenceHours), [24, 72]);
  assert.equal(rows[0].scheduledFor.getTime(), now.getTime() + 24 * 3600000);
  assert.equal(rows[1].scheduledFor.getTime(), now.getTime() + 72 * 3600000);
});

test('utilise un modèle sans texte libre et fournit une clé de corrélation de statut', () => {
  const payload = cloudApi.buildTemplatePayload({ phoneNumber: '+243812345678', templateName: 'nva_follow_up_24h', templateLanguage: 'fr', templateParameters: [], idempotencyKey: 'followup-24h-1' });
  assert.equal(payload.type, 'template');
  assert.equal(payload.biz_opaque_callback_data, 'followup-24h-1');
  assert.equal('components' in payload.template, false);
});

test('worker envoie uniquement le rappel arrivé à échéance via le modèle configuré et réclame la ligne une fois', async () => {
  const acceptedAt = new Date('2026-10-02T11:00:00Z');
  const { client, rows } = makeClient({ now: () => acceptedAt });
  const schedule = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => new Date('2026-10-01T10:00:00Z') });
  await schedule.schedule({ conversationId: 2, consentEventId: 5, consentedAt: new Date('2026-10-01T10:00:00Z') });
  let calls = 0;
  const worker = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => acceptedAt, sender: async (payload) => { calls += 1; assert.equal(payload.templateName, 'nva_follow_up_24h'); return { providerMessageId: 'wamid.followup.1' }; } });
  assert.deepEqual(await worker.processPending(), [{ accepted: true }]);
  assert.equal(rows[0].status, 'ACCEPTED');
  assert.equal(rows[0].providerMessageId, 'wamid.followup.1');
  assert.equal(rows[1].status, 'PENDING');
  await worker.sendFollowUp(rows[0].id);
  assert.equal(calls, 1);
});

test('annule si le consentement a été retiré, si le prospect est inscrit ou si le conseiller a repris la conversation', async (t) => {
  for (const scenario of [
    { name: 'consentement révoqué', consentDecision: 'REVOKED' },
    { name: 'inscription existante', enrolled: true },
    { name: 'transfert humain', controlState: 'HUMAN_TAKEOVER' },
  ]) await t.test(scenario.name, async () => {
    const now = new Date('2026-10-02T11:00:00Z');
    const { client, rows, setEnrolled } = makeClient({ now: () => now, controlState: scenario.controlState, consentDecision: scenario.consentDecision });
    const schedule = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => new Date('2026-10-01T10:00:00Z') });
    await schedule.schedule({ conversationId: 2, consentEventId: 5, consentedAt: new Date('2026-10-01T10:00:00Z') });
    setEnrolled(Boolean(scenario.enrolled));
    let calls = 0;
    const worker = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => now, sender: async () => { calls += 1; return { providerMessageId: 'should-not-send' }; } });
    assert.deepEqual(await worker.processPending(), [{ cancelled: true }]);
    assert.equal(rows[0].status, 'CANCELLED');
    assert.equal(calls, 0);
  });
});

test('une erreur de transport ambiguë devient terminale sans renvoi automatique', async () => {
  const now = new Date('2026-10-02T11:00:00Z');
  const { client, rows } = makeClient({ now: () => now });
  const schedule = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => new Date('2026-10-01T10:00:00Z') });
  await schedule.schedule({ conversationId: 2, consentEventId: 5, consentedAt: new Date('2026-10-01T10:00:00Z') });
  const worker = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => now, sender: async () => { throw Object.assign(new Error('network'), { code: 'DELIVERY_UNCERTAIN', retryable: false }); } });
  assert.deepEqual(await worker.processPending(), [{ failed: true, retryable: false }]);
  assert.equal(rows[0].status, 'FAILED');
  assert.equal(rows[0].failureCode, 'DELIVERY_UNCERTAIN');
});

test('réessaie un 429 avec délai et rattache un statut précoce par clé de corrélation', async () => {
  const now = new Date('2026-10-02T11:00:00Z');
  const { client, rows } = makeClient({ now: () => now });
  const schedule = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => new Date('2026-10-01T10:00:00Z') });
  await schedule.schedule({ conversationId: 2, consentEventId: 5, consentedAt: new Date('2026-10-01T10:00:00Z') });
  const limited = createWhatsAppProspectFollowUpService({ client, configProvider, now: () => now, sender: async () => { throw Object.assign(new Error('rate limited'), { retryable: true, acceptanceRejected: true, code: '429' }); } });
  assert.deepEqual(await limited.processPending(), [{ failed: true, retryable: true }]);
  assert.equal(rows[0].status, 'PENDING');
  assert.equal(rows[0].scheduledFor.getTime(), now.getTime() + 60_000);

  const callbackClient = makeClient({ now: () => now });
  const callbackScheduler = createWhatsAppProspectFollowUpService({ client: callbackClient.client, configProvider, now: () => new Date('2026-10-01T10:00:00Z') });
  await callbackScheduler.schedule({ conversationId: 2, consentEventId: 5, consentedAt: new Date('2026-10-01T10:00:00Z') });
  const callback = createWhatsAppProspectFollowUpService({ client: callbackClient.client, configProvider, now: () => now });
  assert.equal(await callback.applyStatus({ id: 'wamid.early', status: 'sent', biz_opaque_callback_data: callbackClient.rows[0].deduplicationKey }), true);
  assert.equal(callbackClient.rows[0].status, 'SENT');
  assert.equal(callbackClient.rows[0].providerMessageId, 'wamid.early');
  assert.equal(callbackClient.rows[0].sentAt.getTime(), now.getTime());
  assert.equal(await callback.applyStatus({ id: 'wamid.early', status: 'delivered', timestamp: '1791547200' }), true);
  assert.equal(callbackClient.rows[0].deliveredAt.getTime(), 1791547200 * 1000);
});
