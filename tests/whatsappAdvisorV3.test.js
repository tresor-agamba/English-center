const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createMetaInboxMock } = require('./helpers/metaInboxMock');
const { getWhatsAppConfig } = require('../src/config/whatsappConfig');
const { createWhatsAppProspectFollowUpService } = require('../src/services/whatsappProspectFollowUpService');
const { eligible48, verifyTemplate, HOURS_48 } = require('../src/services/whatsappFollowUp48Policy');
const { detectLanguage, validateReply } = require('../src/services/whatsappAdvisorPolicy');
const { createQuestionAIService, config, buildFacts } = require('../src/services/whatsappQuestionAIService');
const { createConversationEngine } = require('../src/services/whatsappConversationEngine');
const course = { id: 1, title: 'Anglais général', slug: 'anglais-general', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16, price: 60, currency: 'USD', pricingActive: true, pricingMode: 'ONE_TIME', accessPolicy: 'LEGACY_STAGED' };
function fixture(overrides = {}) {
  const s = createMetaInboxMock({}, { allowReadCommitted: true });
  const now = new Date('2026-10-26T12:00:00Z'); s.advance(+now - +s.time());
  const cfg = { ...getWhatsAppConfig({}), enabled: true, prospectFollowUpsEnabled: true, prospectFollowUpsDryRun: false, ...overrides };
  s.seed('whatsAppConversation', { id: 1, phoneNumber: '+29999999111', controlState: 'BOT_ACTIVE', engineState: { preferredLanguage: 'fr', selectedCourseId: 1, commercialConsentNoticeVersion: 'lead-follow-up-48h-v3' } });
  s.seed('whatsAppConversationMessage', { id: 1, conversationId: 1, direction: 'INBOUND', receivedAt: new Date(+now - HOURS_48) });
  s.seed('whatsAppCommercialConsentEvent', { id: 5, conversationId: 1, scope: 'COMMERCIAL_FOLLOW_UPS', decision: 'GRANTED', occurredAt: new Date(+now - HOURS_48) });
  const read = s.db.whatsAppProspectFollowUp.findUnique;
  s.db.whatsAppProspectFollowUp.findUnique = async args => {
    const row = await read(args);
    if (row && args.include?.conversation) row.conversation = await s.db.whatsAppConversation.findUnique({ where: { id: row.conversationId } });
    return row;
  };
  let sent = 0, verified = 0;
  const service = createWhatsAppProspectFollowUpService({ client: s.db, configProvider: () => cfg, now: () => now,
    templateVerifier: async () => { verified++; return true; }, sender: async payload => {
      assert.equal(payload.templateName, cfg.prospectFollowUpFrTemplate); assert.equal(payload.templateLanguage, 'fr');
      sent++; return { providerMessageId: 'mock-v3' };
    } });
  async function schedule() {
    await service.schedule({ conversationId: 1, consentEventId: 5, consentedAt: new Date(+now - HOURS_48) });
    const row = s.rows('whatsAppProspectFollowUp')[0];
    Object.assign(row, { status: 'PENDING', attempts: 0, failureCode: null, providerMessageId: null });
    return row;
  }
  return { ...s, now, cfg, service, schedule, sent: () => sent, verified: () => verified };
}
test('V3 is disabled and simulated by default; timeout 10000 is valid', () => {
  const c = getWhatsAppConfig({}); assert.equal(c.prospectFollowUpsEnabled, false); assert.equal(c.prospectFollowUpsDryRun, true);
  assert.equal(config({ NVA_AI_ENABLED: 'true', OPENAI_API_KEY: randomUUID(), OPENAI_MODEL: 'mock', NVA_AI_TIMEOUT_MS: '10000' }).timeout, 10000);
});
test('one durable 48h row per conversation, even across repeated consents', async () => {
  const f = fixture(); await f.schedule();
  await f.service.schedule({ conversationId: 1, consentEventId: 6, consentedAt: f.now });
  assert.equal(f.rows('whatsAppProspectFollowUp').length, 1);
  assert.equal(f.rows('whatsAppProspectFollowUp')[0].sequenceHours, 48);
});
test('two concurrent workers submit exactly once through the recipient transaction', async () => {
  const f = fixture(); const row = await f.schedule();
  await Promise.all([f.service.sendFollowUp(row.id), f.service.sendFollowUp(row.id)]);
  assert.equal(f.sent(), 1); assert.equal(f.rows('whatsAppProspectFollowUp')[0].status, 'ACCEPTED');
});
test('inactivity threshold, interest, privacy retention and admission checks', async t => {
  for (const [name, change] of [
    ['47h59', f => f.rows('whatsAppConversationMessage')[0].receivedAt = new Date(+f.now - HOURS_48 + 1)],
    ['new inbound', f => f.seed('whatsAppConversationMessage', { id: 2, conversationId: 1, direction: 'INBOUND', receivedAt: f.now })],
    ['no interest', f => f.rows('whatsAppConversation')[0].engineState.selectedCourseId = null],
    ['old consent scope', f => f.rows('whatsAppConversation')[0].engineState.commercialConsentNoticeVersion = null],
    ['expired prospect', f => f.rows('whatsAppConversationMessage')[0].receivedAt = new Date(+f.now - 91 * 86400000)],
    ['pending admission', f => f.seed('whatsAppAdmissionRequest', { id: 1, conversationId: 1, status: 'PENDING' })],
    ['processing admission', f => f.seed('whatsAppAdmissionRequest', { id: 1, conversationId: 1, status: 'PROCESSING' })],
    ['admitted', f => f.seed('whatsAppAdmissionRequest', { id: 1, conversationId: 1, status: 'ENROLLED' })],
    ['STOP', f => f.rows('whatsAppConversation')[0].engineState.optedOut = true],
  ]) await t.test(name, async () => {
    const f = fixture(); const row = await f.schedule(); change(f);
    assert.equal(await eligible48(f.db, { ...row, conversation: f.rows('whatsAppConversation')[0] }, f.now, f.cfg), false);
    await f.service.sendFollowUp(row.id); assert.equal(f.sent(), 0);
  });
});
test('no consent, revoked consent, enrolled user and human takeover never send', async t => {
  for (const name of ['missing', 'revoked', 'enrolled', 'human']) await t.test(name, async () => {
    const f = fixture(); const row = await f.schedule();
    if (name === 'missing') f.rows('whatsAppCommercialConsentEvent').splice(0);
    if (name === 'revoked') f.rows('whatsAppCommercialConsentEvent')[0].decision = 'REVOKED';
    if (name === 'human') f.rows('whatsAppConversation')[0].controlState = 'HUMAN_TAKEOVER';
    if (name === 'enrolled') { f.seed('user', { id: 1, phoneNumber: '+29999999111' }); f.seed('enrollment', { id: 1, userId: 1 }); }
    await f.service.sendFollowUp(row.id); assert.equal(f.sent(), 0);
  });
});
test('simulation does not claim rows or contact Meta; unapproved templates never send', async () => {
  const f = fixture({ prospectFollowUpsDryRun: true }); const row = await f.schedule();
  assert.equal((await f.service.sendFollowUp(row.id)).simulated, true);
  assert.equal(f.sent(), 0); assert.equal(f.verified(), 0); assert.equal(row.status, 'PENDING');
  const g = fixture({ prospectFollowUpsEnabled: false }); const other = await g.schedule();
  await g.service.sendFollowUp(other.id); assert.equal(g.verified(), 0);
  const blocked = createWhatsAppProspectFollowUpService({ client: f.db, configProvider: () => ({ ...f.cfg, prospectFollowUpsDryRun: false }), now: () => f.now, templateVerifier: async () => false, sender: async () => assert.fail('no send') });
  assert.equal((await blocked.sendFollowUp(row.id)).reason, 'TEMPLATE_NOT_VERIFIED');
});
test('Meta approval must match WABA lookup, ID, name, category, locale and static body', async () => {
  const cfg = { graphApiVersion: 'v23.0', businessAccountId: '123', prospectFollowUpFrTemplateId: '456' };
  const row = { templateName: 'nva_followup_fr', templateLanguage: 'fr' };
  const approved = { id: '456', name: row.templateName, status: 'APPROVED', category: 'MARKETING', language: 'fr', components: [{ type: 'BODY', text: 'Bonjour, souhaitez-vous poursuivre ? Répondez STOP pour arrêter.' }] };
  for (const [change, expected] of [[{}, true], [{ status: 'PENDING' }, false], [{ category: 'UTILITY' }, false], [{ language: 'en' }, false], [{ id: '999' }, false], [{ components: [{ type: 'BODY', text: '{{1}}' }] }, false]]) {
    assert.equal(await verifyTemplate(cfg, row, async url => { assert.match(url, /123\/message_templates/); return { ok: true, json: async () => ({ data: [{ ...approved, ...change }] }) }; }), expected);
  }
});
test('language persists for short answers and follows explicit switches', () => {
  assert.equal(detectLanguage('I want to learn for work'), 'en');
  assert.equal(detectLanguage('OK', 'en'), 'en');
  assert.equal(detectLanguage('en français', 'en'), 'fr');
});
test('published certificate fee overrides commercial defaults; online is never assumed', () => {
  const facts = buildFacts([{ ...course, certificateFee: 35, trainingMode: 'ONSITE' }], []);
  assert.match(facts.find(f => f.id === 'c1_certificate_fee').fr, /35 USD/);
  assert.match(facts.find(f => f.id === 'c1_certificate_fee').fr, /215 USD/);
  assert.equal(facts.some(f => f.id === 'online'), false);
  assert.equal(validateReply('Your enrollment is confirmed', [], 'en'), null);
});
test('old consent prompts cannot authorize the new 48h marketing scope', async () => {
  const e = createConversationEngine();
  const result = await e.handleMessage({ text: 'OUI RELANCES', messageId: 'old-consent', state: {
    commercialFollowUpConsentRequestedAt: new Date().toISOString(), commercialConsentRequestedVersion: 'lead-follow-up-24h-72h-v1',
  } });
  assert.equal(result.actions.length, 0);
  assert.equal(result.intent, 'COMMERCIAL_CONSENT_NOT_REQUESTED');
});
test('retention previews without writes and purges content while preserving opt-out', async () => {
  const { purgeInactiveProspects } = require('../src/services/whatsappProspectRetentionService');
  const changes = [];
  const row = { id: 1, phoneNumber: '+29999999111', controlState: 'OPTED_OUT' };
  const tx = { $queryRaw: async () => [],
    whatsAppConversation: { findMany: async () => [row], findFirst: async () => row, update: async args => changes.push(args.data) },
    whatsAppConversationMessage: { updateMany: async args => changes.push(args.data) },
    whatsAppProspectFollowUp: { updateMany: async args => changes.push(args.data) },
  };
  const db = { ...tx, $transaction: async work => work(tx) };
  assert.deepEqual(await purgeInactiveProspects(db), { dryRun: true, candidates: 1 }); assert.equal(changes.length, 0);
  assert.deepEqual(await purgeInactiveProspects(db, { dryRun: false }), { dryRun: false, purged: 1 });
  assert.deepEqual(changes[0], { body: null, interactivePayload: null });
  assert.equal(changes[1].status, 'CANCELLED'); assert.deepEqual(changes[2].engineState, { optedOut: true });
});
test('natural FR/EN replies use Responses without tools and reject invented prices', async () => {
  for (const [language, question, reply] of [['fr', 'Je veux apprendre pour mon travail', 'Pour votre travail, quelles situations souhaitez-vous mieux gérer en anglais ?'], ['en', 'I want to learn for work', 'Which situations at work would you like to handle more confidently in English?']]) {
    const ai = createQuestionAIService({ env: { NVA_AI_ENABLED: 'true', OPENAI_API_KEY: randomUUID(), OPENAI_MODEL: 'mock' }, fetchImpl: async (url, options) => {
      const request = JSON.parse(options.body); assert.equal(request.store, false); assert.equal(request.tools, undefined);
      assert.match(request.instructions, /without pressure/);
      return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ language, factIds: [], opening: 'none', followUp: 'work' }) }] }] }) };
    } });
    assert.equal(await ai.answer({ question, facts: buildFacts([course], []), reserve: async () => true }), require('../src/services/whatsappAdvisorPolicy').QUESTIONS.work[language][0]);
  }
  assert.equal(validateReply('Promotion : 10 USD !', [], 'fr'), null);
  assert.equal(validateReply('Pay https://fake.invalid', [], 'en'), null);
});
test('explicit bilingual consent and natural opt-out preempt AI', async () => {
  const e = createConversationEngine({ env: { NVA_AI_ENABLED: 'true' }, catalog: { listPublished: async () => [course] } });
  const initial = { mode: 'QUESTION_AI', preferredLanguage: 'en' };
  const ask = await e.handleMessage({ text: 'follow ups', state: initial, messageId: 'ask' });
  assert.match(ask.text, /48 hours/); assert.equal(ask.deferredQuestionAI, undefined);
  const consent = await e.handleMessage({ text: 'YES FOLLOW UPS', state: ask.state, messageId: 'yes' });
  assert.equal(consent.actions[0].type, 'COMMERCIAL_CONSENT_GRANT');
  const stop = await e.handleMessage({ text: 'Please do not contact me again', state: consent.state, messageId: 'stop' });
  assert.equal(stop.actions[0].type, 'OPT_OUT');
});
