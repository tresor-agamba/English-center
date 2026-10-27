// Launched only by the fresh-cluster harness. No dotenv and no live transports.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
test('NVA V3 on a pristine dedicated PostgreSQL cluster', { skip: !process.env.NVA_V3_LAB_URL }, async t => {
  const raw = process.env.NVA_V3_LAB_URL, url = new URL(raw);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '59432'); assert.equal(url.pathname, '/nva_whatsapp_v3_test');
  assert.equal(url.username, 'nva_v3_lab_runner'); assert.equal(url.search, '');
  const directory = path.resolve(process.env.NVA_V3_LAB_DIRECTORY);
  assert.ok(directory.startsWith(path.resolve(__dirname, '../output/nva-v3-corrections') + path.sep));
  process.env.DATABASE_URL = raw; process.env.NODE_ENV = 'test';
  let externalAttempts = 0;
  global.fetch = async () => { externalAttempts++; throw Error('EXTERNAL_NETWORK_FORBIDDEN'); };
  const db = require('../src/utils/prisma'); t.after(() => db.$disconnect());
  const [identity] = await db.$queryRaw`SELECT current_database() db,current_user role,host(inet_server_addr()) host,inet_server_port() port,public.nva_v3_cluster_directory() directory`;
  assert.equal(identity.db, 'nva_whatsapp_v3_test'); assert.equal(identity.role, 'nva_v3_lab_runner'); assert.equal(identity.port, 59432);
  assert.equal(identity.host, '127.0.0.1'); assert.equal(path.resolve(identity.directory).toLowerCase(), directory.toLowerCase());
  const [rights] = await db.$queryRaw`SELECT has_schema_privilege(current_user,'public','CREATE') can_create,has_table_privilege(current_user,'public.users','TRUNCATE') can_truncate,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`;
  assert.ok(Object.values(rights).every(v => v === false));
  for (const model of ['user', 'course', 'enrollment', 'whatsAppConversation', 'whatsAppAdmissionRequest']) assert.equal(await db[model].count(), 0, 'Pristine database required');
  let clock = new Date(); let sequence = 0; let mockCalls = 0;
  const env = { NVA_AI_ENABLED: 'true', OPENAI_API_KEY: randomUUID(), OPENAI_MODEL: 'gpt-4.1-mini', NVA_AI_TIMEOUT_MS: '10000', NVA_AI_DAILY_CALL_LIMIT: '100' };
  const config = { ...require('../src/config/whatsappConfig').getWhatsAppConfig({}), enabled: true, prospectFollowUpsEnabled: true, prospectFollowUpsDryRun: false };
  const followupFactory = require('../src/services/whatsappProspectFollowUpService').createWhatsAppProspectFollowUpService;
  const followups = followupFactory({ client: db, configProvider: () => config, now: () => clock });
  const conversation = require('../src/services/whatsappConversationService').createWhatsAppConversationService({ client: db, env, followUps: followups, followUpConfig: () => config, now: () => clock });
  const { buildFacts, createQuestionAIService } = require('../src/services/whatsappQuestionAIService');
  const catalog = require('../src/services/publicCourseService'), registration = require('../src/services/registrationService');
  const course = await db.course.create({ data: { title: 'Anglais général', slug: 'anglais-general', shortDescription: 'Cours en direct pour progresser en anglais', durationValue: 8, durationUnit: 'WEEKS', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16, accessPolicy: 'LEGACY_STAGED', price: 60, currency: 'USD', certificateFee: 20, trainingMode: 'ONLINE', pricingActive: true, pricingMode: 'ONE_TIME', isPublished: true, lmsStatus: 'PUBLISHED' } });
  const session = await db.trainingSession.create({ data: { courseId: course.id, name: 'Synthetic session', levelNumber: 1, startDate: new Date('2099-01-01'), endDate: new Date('2099-04-01'), registrationDeadline: new Date('2098-12-31'), capacity: 10, status: 'OPEN', weekDays: ['Friday'], startTime: '18:00', endTime: '19:30' } });
  await db.registrationGroup.create({ data: { trainingSessionId: session.id, name: 'Synthetic group', capacity: 10, weekDays: ['Friday'], startTime: '18:00', endTime: '19:30' } });
  await db.whatsAppChatbotSettings.create({ data: { id: 1, enabled: true, admissionsEnabled: true } });
  const transcript = [], requests = [];
  let response = { language: 'fr', factIds: [], opening: 'welcome', followUp: 'goal' };
  const ai = createQuestionAIService({ env, fetchImpl: async (endpoint, options) => {
    mockCalls++; assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body); assert.equal(request.model, 'gpt-4.1-mini'); assert.equal(request.store, false); assert.equal(request.tools, undefined);
    assert.equal(request.text.format.type, 'json_schema'); assert.equal(request.text.format.strict, true);
    assert.deepEqual(new Set(request.text.format.schema.required), new Set(['language', 'factIds', 'opening', 'followUp']));
    requests.push(request);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(response) }] }] }) };
  } });
  const completion = require('../src/services/whatsappQuestionAICompletionService').createQuestionAICompletionService({ database: db, env, ai, now: () => clock });
  async function inbound(text, phone = '29999999111', nativeId = 'v3-' + (++sequence)) {
    const message = { id: nativeId, from: phone, type: 'text', text: { body: text }, timestamp: String(Math.floor(+clock / 1000)) };
    const result = await db.$transaction(tx => conversation.processInboundMessageInTransaction(tx, message, { firstReceivedAt: clock, processedAt: clock }), { isolationLevel: 'Serializable', timeout: 10000 });
    const before = await db.whatsAppConversationMessage.findUnique({ where: { idempotencyKey: 'wa-reply:' + nativeId + ':0' } });
    await completion.completeReply('wa-reply:' + nativeId + ':0');
    const prepared = await db.whatsAppConversationMessage.findUnique({ where: { idempotencyKey: 'wa-reply:' + nativeId + ':0' } });
    transcript.push({ source: 'SYNTHETIC_OPENAI_RESPONSE', phone: '[synthetic]', input: text, output: prepared?.body, pendingBeforeCompletion: before?.failureCode });
    return { ...result, nativeId, prepared };
  }
  await t.test('catalogue, published prices, trial, staged payment, certificate and live SQL sessions', async () => {
    const courses = await catalog.listPublished(db), sessions = await registration.listSessionsForPublicRegistration(db);
    assert.equal(courses.length, 1); assert.equal(sessions.length, 1); assert.equal(sessions[0].id, session.id);
    const facts = buildFacts(courses, sessions), all = JSON.stringify(facts);
    for (const value of ['60 USD', '180 USD', '200 USD', '30 USD', '16 séances', '90 minutes', '5 séances', '6e séance', '20 USD', '18:00']) assert.ok(all.includes(value), value);
    const other = buildFacts([{ ...courses[0], id: 2, title: 'Excel', slug: 'excel', price: 95 }], []);
    assert.ok(!JSON.stringify(other).includes('200 USD')); assert.ok(!JSON.stringify(other).includes('30 USD'));
  });
  await t.test('simulated inbound to committed pending reply to grounded Responses answer, FR and EN', async () => {
    for (const text of ['menu', '3']) await inbound(text);
    const first = await inbound('Je veux apprendre anglais général pour mon travail');
    assert.match(first.prepared.body, /Avec plaisir/); assert.equal(first.prepared.failureCode, null); assert.equal(first.prepared.deliveryStatus, 'QUEUED');
    assert.equal(transcript.at(-1).pendingBeforeCompletion, 'QUESTION_AI_PENDING');
    response = { language: 'fr', factIds: ['c' + course.id + '_payment'], opening: 'budget', followUp: 'clarify' };
    await inbound('Puis-je payer en deux fois ?');
    response = { language: 'en', factIds: [], opening: 'goal', followUp: 'work' };
    await inbound('Please reply in English');
    let c = await db.whatsAppConversation.findUnique({ where: { id: first.conversationId } }); assert.equal(c.engineState.preferredLanguage, 'en');
    await inbound('OK'); c = await db.whatsAppConversation.findUnique({ where: { id: c.id } }); assert.equal(c.engineState.preferredLanguage, 'en');
    assert.equal(JSON.parse(requests.at(-1).input).preferredLanguage, 'en');
    assert.ok(new Set(transcript.filter(r => r.pendingBeforeCompletion).map(r => r.output)).size > 1, 'Varied synthetic examples only, not model quality measurement');
  });
  await t.test('registration intent exits AI and uses the existing site/WhatsApp secure method menu', async () => {
    const before = mockCalls, result = await inbound('I want to register');
    const c = await db.whatsAppConversation.findUnique({ where: { id: result.conversationId } });
    assert.notEqual(c.engineState.mode, 'QUESTION_AI'); assert.equal(c.engineState.admission.step, 'METHOD');
    assert.deepEqual(c.engineState.admission.options.map(o => o.id), ['online', 'admin', 'menu']);
    assert.equal(mockCalls, before); assert.equal(await db.enrollment.count(), 0); assert.equal(await db.whatsAppAdmissionRequest.count(), 0);
  });
  async function prospect(phone) {
    clock = new Date();
    response = { language: 'fr', factIds: [], opening: 'goal', followUp: 'goal' };
    for (const text of ['menu', '3', 'Je souhaite apprendre anglais général', 'relances', 'OUI RELANCES']) await inbound(text, phone);
    const c = await db.whatsAppConversation.findUnique({ where: { phoneNumber: '+' + phone } });
    return { c, row: await db.whatsAppProspectFollowUp.findFirst({ where: { conversationId: c.id } }) };
  }
  async function due(f, ageMs = 49 * 3600000) {
    clock = new Date();
    const last = await db.whatsAppConversationMessage.findFirst({ where: { conversationId: f.c.id, direction: 'INBOUND' }, orderBy: { id: 'desc' } });
    await db.whatsAppConversationMessage.update({ where: { id: last.id }, data: { receivedAt: new Date(+clock - ageMs) } });
    await db.whatsAppProspectFollowUp.update({ where: { id: f.row.id }, data: { scheduledFor: new Date(+clock - 1000) } });
  }
  await t.test('explicit consent, refreshed inactivity, two real PostgreSQL workers and no duplicate submission', async () => {
    const f = await prospect('29999999222'); assert.ok(f.row); assert.equal(f.row.sequenceHours, 48);
    const event = await db.whatsAppCommercialConsentEvent.findUnique({ where: { id: f.row.consentEventId } }); assert.equal(event.noticeVersion, 'lead-follow-up-48h-v3');
    let sent = 0; const worker = followupFactory({ client: db, configProvider: () => config, now: () => clock, templateVerifier: async () => true,
      sender: async data => { assert.equal(data.templateName, 'nva_followup_fr'); sent++; return { providerMessageId: 'synthetic-followup-' + randomUUID() }; } });
    // Backdate only our fixtures: SQL authorization deliberately uses server time.
    await due(f, 48 * 3600000 - 5000);
    await worker.sendFollowUp(f.row.id); assert.equal(sent, 0);
    clock = new Date();
    await inbound('merci', '29999999222');
    const postponed = await db.whatsAppProspectFollowUp.findUnique({ where: { id: f.row.id } });
    assert.equal(+postponed.scheduledFor, +clock + 48 * 3600000);
    await worker.sendFollowUp(f.row.id); assert.equal(sent, 0);
    await due(f);
    await Promise.all([worker.sendFollowUp(f.row.id), worker.sendFollowUp(f.row.id)]); assert.equal(sent, 1);
    await worker.sendFollowUp(f.row.id); assert.equal(sent, 1);
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({ where: { id: f.row.id } })).status, 'ACCEPTED');
  });
  await t.test('STOP withdrawal is durable and prevents any follow-up', async () => {
    const f = await prospect('29999999333'); await inbound('STOP', '29999999333');
    const worker = followupFactory({ client: db, configProvider: () => config, now: () => clock, templateVerifier: async () => true, sender: async () => assert.fail('STOP must prevent sending') });
    await worker.sendFollowUp(f.row.id);
    assert.equal((await db.whatsAppConversation.findUnique({ where: { id: f.c.id } })).controlState, 'OPTED_OUT');
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({ where: { id: f.row.id } })).status, 'CANCELLED');
    assert.equal((await db.whatsAppCommercialConsentEvent.findFirst({ where: { conversationId: f.c.id }, orderBy: { id: 'desc' } })).decision, 'REVOKED');
  });
  await t.test('pending registration, missing consent, enrolled and unapproved template block follow-ups', async () => {
    const pending = await prospect('29999999444');
    await db.whatsAppAdmissionRequest.create({ data: { conversationId: pending.c.id, fullName: 'Synthetic Prospect', phoneNumber: pending.c.phoneNumber, email: 'synthetic@example.test', requestedLevel: 'BEGINNER', sourceMessageId: 'synthetic-admission-' + randomUUID() } });
    const none = await prospect('29999999555'); await db.whatsAppCommercialConsentEvent.create({ data: { conversationId: none.c.id, scope: 'COMMERCIAL_FOLLOW_UPS', decision: 'REVOKED', source: 'WHATSAPP_INBOUND', occurredAt: new Date(+clock + 1), deduplicationKey: randomUUID() } });
    const enrolled = await prospect('29999999888');
    const user = await db.user.create({ data: { firstName: 'Synthetic', lastName: 'Student', phoneNumber: enrolled.c.phoneNumber, passwordHash: randomUUID(), role: 'STUDENT' } });
    await db.enrollment.create({ data: { userId: user.id, trainingSessionId: session.id } });
    const unapproved = await prospect('29999999666');
    for (const f of [pending, none, enrolled, unapproved]) await due(f);
    const worker = followupFactory({ client: db, configProvider: () => config, now: () => clock, templateVerifier: async () => false, sender: async () => assert.fail('No template may be sent') });
    await worker.sendFollowUp(pending.row.id); await worker.sendFollowUp(none.row.id); await worker.sendFollowUp(enrolled.row.id);
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({ where: { id: enrolled.row.id } })).status, 'CANCELLED');
    assert.equal((await worker.sendFollowUp(unapproved.row.id)).reason, 'TEMPLATE_NOT_VERIFIED');
  });
  await t.test('inbound duplicate constraint and simultaneous committed messages', async () => {
    const id = 'same-native-' + randomUUID();
    const results = await Promise.allSettled([inbound('menu', '29999999777', id), inbound('menu', '29999999777', id)]);
    assert.ok(results.some(r => r.status === 'fulfilled'));
    assert.equal(await db.whatsAppConversationMessage.count({ where: { providerMessageId: id } }), 1);
    assert.equal(await db.whatsAppConversationMessage.count({ where: { idempotencyKey: 'wa-reply:' + id + ':0' } }), 1);
  });
  await t.test('default-disabled follow-ups never claim due rows; dry run never invokes transport', async () => {
    const row = await db.whatsAppProspectFollowUp.findFirst({ where: { status: 'PENDING' } }); assert.ok(row);
    const defaults = require('../src/config/whatsappConfig').getWhatsAppConfig({}); assert.equal(defaults.prospectFollowUpsEnabled, false); assert.equal(defaults.prospectFollowUpsDryRun, true);
    const disabled = followupFactory({ client: db, configProvider: () => ({ ...defaults, enabled: true }), now: () => clock, sender: async () => assert.fail('disabled') });
    assert.deepEqual(await disabled.processPending(), []);
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({ where: { id: row.id } })).attempts, 0);
    const simulated = followupFactory({ client: db, configProvider: () => ({ ...config, prospectFollowUpsDryRun: true }), now: () => clock,
      templateVerifier: async () => assert.fail('simulation must not call Meta'), sender: async () => assert.fail('simulation must not send') });
    assert.equal((await simulated.sendFollowUp(row.id)).simulated, true);
    assert.equal((await db.whatsAppProspectFollowUp.findUnique({ where: { id: row.id } })).attempts, 0);
  });
  assert.equal(externalAttempts, 0);
  fs.writeFileSync(path.join(process.env.NVA_V3_LAB_EVIDENCE, 'business-evidence.json'), JSON.stringify({ identity, rights, mockOpenAICalls: mockCalls, realExternalAttempts: externalAttempts, configuredModel: env.OPENAI_MODEL, transcript, preparedMessages: await db.whatsAppConversationMessage.count({ where: { direction: 'OUTBOUND' } }) }, null, 2));
});
