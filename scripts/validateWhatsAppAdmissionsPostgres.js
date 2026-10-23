// Explicit local validation target only. Never loads dotenv or sends WhatsApp.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const target = { host: '127.0.0.1', port: 56432, database: 'nva_admissions_validation_v2', user: 'nva_validation_app' };
const out = path.join(root, 'output/postgres-validation');
const results = [];
const commercial = [];
const run = crypto.randomUUID().slice(0, 8);
const nativeFetch = global.fetch;
// Drop inherited application configuration, including any real credentials.
for (const key of Object.keys(process.env)) {
  if (/DATABASE_URL|^WHATSAPP_|^META_|^OPENAI_|^NVA_CHATBOT_|^SMTP_|^MAIL_/i.test(key)) delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: 'test', CSRF_ENFORCE: 'true',
  DATABASE_URL: 'postgresql://nva_validation_app@127.0.0.1:56432/nva_admissions_validation_v2?schema=public&sslmode=disable',
  WHATSAPP_ENABLED: 'false', WHATSAPP_WORKERS_ENABLED: 'false', META_WHATSAPP_INBOX_ENABLED: 'false', NVA_CHATBOT_AI_ENABLED: 'false',
  SESSION_SECRET: crypto.randomBytes(48).toString('hex'),
});
global.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.hostname, '127.0.0.1', 'External HTTP is forbidden');
  return nativeFetch(input, options);
};
let prisma, server, sql;
async function check(name, fn) {
  try { const detail = await fn(); results.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ name, status: 'FAIL', code: error.code || error.name, detail: require('../src/services/loggerService').sanitizeString(String(error.message)).slice(-1800) }); }
  console.log(results.at(-1).status + ' ' + name);
}
async function main() {
  sql = new Client(target); await sql.connect();
  const { rows: [identity] } = await sql.query("SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port");
  assert.deepEqual(identity, { db: target.database, role: target.user, host: target.host, port: target.port });
  const adminSql = new Client({ ...target, user: 'nva_validation_owner' }); await adminSql.connect();
  const { rows: [dir] } = await adminSql.query("SELECT current_setting('data_directory') AS dir");
  assert.equal(path.resolve(dir.dir).toLowerCase(), path.join(out, 'cluster').toLowerCase());
  await adminSql.end();
  prisma = require('../src/utils/prisma');
  const passwords = require('../src/services/passwordService');
  const password = crypto.randomBytes(18).toString('hex') + 'Aa!7';
  const passwordHash = await passwords.hashPassword(password);
  const phones = { admin: '+243890001001', student: '+243890001002', prospect: '+243890001003' };
  const prior = await prisma.user.findMany({ select: { phoneNumber: true } });
  assert.ok(prior.length === 0 || (prior.length === 2 && prior.every(u => [phones.admin, phones.student].includes(u.phoneNumber)) && await prisma.course.count() === 0 && await prisma.enrollment.count() === 0), 'Pristine fixtures required; no reset allowed');
  const admin = await prisma.user.upsert({ where: { phoneNumber: phones.admin }, update: { passwordHash }, create: { firstName: 'Validation', lastName: 'Administrateur', phoneNumber: phones.admin, role: 'ADMIN', passwordHash, mustChangePassword: false } });
  const student = await prisma.user.upsert({ where: { phoneNumber: phones.student }, update: { passwordHash }, create: { firstName: 'Validation', lastName: 'Etudiant', phoneNumber: phones.student, role: 'STUDENT', passwordHash, mustChangePassword: false } });
  const course = await prisma.course.create({ data: {
    title: 'Anglais pratique NVA', slug: 'validation-nva-' + run, shortDescription: 'Apprentissage pratique de l’anglais, entièrement en ligne.',
    structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16, accessPolicy: 'LEGACY_STAGED',
    price: 60, currency: 'USD', pricingMode: 'ONE_TIME', pricingActive: true, registrationFee: 0,
    durationValue: 8, durationUnit: 'WEEKS', trainingMode: 'ONLINE', isPublished: true, lmsStatus: 'PUBLISHED',
  } });
  const session = await prisma.trainingSession.create({ data: {
    name: 'Niveau 1 — validation isolée', courseId: course.id, levelNumber: 1,
    startDate: new Date('2099-01-01'), endDate: new Date('2099-05-01'), registrationDeadline: new Date('2098-12-31'),
    capacity: 10, status: 'OPEN', weekDays: ['Friday', 'Saturday'], startTime: '10:00', endTime: '11:30', platform: 'GOOGLE_MEET',
  } });
  const group = await prisma.registrationGroup.create({ data: { trainingSessionId: session.id, name: 'Matin', weekDays: ['Friday', 'Saturday'], startTime: '10:00', endTime: '11:30', capacity: 10 } });
  await prisma.whatsAppChatbotSettings.upsert({ where: { id: 1 }, create: { id: 1, enabled: true, admissionsEnabled: true, aiEnabled: false }, update: { enabled: true, admissionsEnabled: true, aiEnabled: false } });
  await check('Rôle applicatif sans superuser, DDL, TRUNCATE ni propriété', async () => {
    const { rows: [r] } = await sql.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,has_database_privilege(current_user,current_database(),'CREATE') AS db_create,has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_table_privilege(current_user,'\"WhatsAppAdmissionRequest\"','TRUNCATE') AS truncate FROM pg_roles WHERE rolname=current_user");
    assert.ok(Object.values(r).every(v => v === false));
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND relnamespace='public'::regnamespace")).rows[0].n, 0);
    await assert.rejects(() => sql.query('CREATE TABLE public.validation_forbidden(id int)'), e => e.code === '42501');
  });
  await check('Rôle ingress sans accès aux demandes ni inscriptions', async () => {
    const ingress = new Client({ ...target, user: 'nva_validation_ingress' }); await ingress.connect();
    try { await assert.rejects(() => ingress.query('SELECT * FROM public."WhatsAppAdmissionRequest"'), e => e.code === '42501'); await assert.rejects(() => ingress.query('SELECT * FROM public.enrollments'), e => e.code === '42501'); }
    finally { await ingress.end(); }
  });
  const { createWhatsAppConversationService } = require('../src/services/whatsappConversationService');
  const { createMetaInboxPrismaAdapter } = require('../src/services/metaInboxPrismaAdapter');
  const service = createWhatsAppConversationService();
  const endpointId = crypto.randomUUID();
  const adapter = createMetaInboxPrismaAdapter({ endpointId, conversationService: service });
  let last, inbound;
  async function receive(text, option, { viaAdapter = false } = {}) {
    const conv = await prisma.whatsAppConversation.findUnique({ where: { phoneNumber: phones.prospect } });
    const selected = option ? conv.engineState.admission.options.find(o => o.id === option) : null;
    assert.ok(!option || selected, 'Option exists: ' + option);
    const kind = last?.interactivePayload?.type === 'list' ? 'list_reply' : 'button_reply';
    inbound = { id: 'wamid.validation.' + crypto.randomUUID(), from: phones.prospect.slice(1), timestamp: String(Math.floor(Date.now() / 1000)),
      ...(option ? { type: 'interactive', interactive: { [kind]: { id: selected.wireId, title: 'Libellé ignoré pour le dispatch' } } } : { type: 'text', text: { body: text } }) };
    const now = new Date();
    const result = viaAdapter ? await prisma.$transaction(tx => adapter(tx, inbound, { endpointId, firstReceivedAt: now, processedAt: now }), { isolationLevel: 'Serializable' }) : await service.processInboundMessage(inbound);
    assert.equal(result.ignored, false);
    last = await prisma.whatsAppConversationMessage.findFirst({ where: { idempotencyKey: 'wa-reply:' + inbound.id + ':0' } });
    assert.ok(last);
    commercial.push({ input: option || text, text: last.body, interactiveBody: last.interactivePayload?.body?.text });
    return last;
  }
  await check('Accueil persistant : anglais en ligne et certifiant', async () => { const r = await receive('bonjour'); assert.match(r.body, /100 % en ligne/); assert.match(r.body, /certifiantes/); assert.equal(r.interactivePayload.type, 'list'); });
  await check('Tarifs via réponse liste Meta et données PostgreSQL réelles', async () => { const r = await receive('', 'price', { viaAdapter: true }); assert.match(r.body, /60 USD par niveau/); assert.match(r.body, /16 séances par niveau/); assert.match(r.body, /trois niveaux, soit 48 séances/); assert.match(r.body, /uniquement après les trois niveaux/); assert.match(r.body, /5 séances d’essai gratuites/); });
  await check('OUI puis choix administrateur via boutons Meta', async () => { await receive('', 'yes', { viaAdapter: true }); await receive('', 'admin'); assert.match(last.body, /collecte temporaire/); });
  await check('Consentement et collecte réelle sans demande prématurée', async () => {
    await receive('', 'accept'); await receive('Marie Validation'); await receive('', 'phone-confirm'); await receive('marie.validation@example.test'); await receive('', 'level-BEGINNER');
    assert.equal(await prisma.whatsAppAdmissionRequest.count(), 0); assert.match(last.body, /Récapitulatif/);
  });
  let request;
  await check('Confirmation : demande et événement réellement commités', async () => {
    await receive('', 'confirm', { viaAdapter: true }); request = await prisma.whatsAppAdmissionRequest.findUniqueOrThrow({ where: { sourceMessageId: inbound.id } });
    assert.equal(request.status, 'PENDING'); assert.equal(request.fullName, 'Marie Validation'); assert.equal(request.phoneNumber, phones.prospect); assert.equal(request.consentVersion, 'admissions-v1');
    assert.equal(await prisma.whatsAppAdmissionEvent.count({ where: { requestId: request.id, action: 'CONSENT_CONFIRMED' } }), 1);
    assert.equal(await prisma.enrollment.count(), 0); assert.equal(await prisma.notification.count({ where: { userId: admin.id, deduplicationKey: 'wa-admission:' + request.id + ':' + admin.id } }), 1);
  });
  await check('Webhook répété : aucune seconde demande ni notification', async () => { const now = new Date(); const r = await prisma.$transaction(tx => adapter(tx, inbound, { endpointId, firstReceivedAt: now, processedAt: now }), { isolationLevel: 'Serializable' }); assert.equal(r.duplicate, true); assert.equal(await prisma.whatsAppAdmissionRequest.count(), 1); });
  if (!request) throw new Error('Cannot continue dashboard without committed admission');
  await check('Contraintes SQL : unicité, FK, niveau, statut et cohérence inscription', async () => {
    const base = { ...request }; for (const key of ['id', 'createdAt', 'updatedAt']) delete base[key];
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.create({ data: base }), e => e.code === 'P2002');
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.create({ data: { ...base, sourceMessageId: 'new-' + run } }), e => e.code === 'P2002');
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.create({ data: { ...base, conversationId: 2147483000, sourceMessageId: 'fk-' + run } }), e => e.code === 'P2003');
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.update({ where: { id: request.id }, data: { requestedLevel: 'INVALID' } }));
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.update({ where: { id: request.id }, data: { status: 'INVALID' } }));
    await assert.rejects(() => prisma.whatsAppAdmissionRequest.update({ where: { id: request.id }, data: { status: 'ENROLLED' } }));
    assert.equal((await prisma.whatsAppAdmissionRequest.findUnique({ where: { id: request.id } })).status, 'PENDING');
  });
  const app = require('../src/app');
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  async function http(jar, url, data) {
    const res = await global.fetch(baseUrl + url, { method: data ? 'POST' : 'GET', redirect: 'manual', headers: { ...(jar.cookie ? { cookie: jar.cookie } : {}), ...(data ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, ...(data ? { body: new URLSearchParams(data) } : {}) });
    const cookie = res.headers.get('set-cookie'); if (cookie) jar.cookie = cookie.split(';')[0];
    const text = await res.text(); const csrf = text.match(/name="_csrf" value="([^"]+)"/); if (csrf) jar.csrf = csrf[1];
    return { status: res.status, text, headers: res.headers };
  }
  async function login(phone) { const jar = {}; await http(jar, '/login'); const r = await http(jar, '/login', { phoneNumber: phone, password, _csrf: jar.csrf }); assert.equal(r.status, 302); return jar; }
  let adminJar;
  await check('Connexion administrateur et sessions PostgreSQL', async () => { adminJar = await login(phones.admin); assert.ok((await sql.query('SELECT count(*)::int AS n FROM http_sessions')).rows[0].n > 0); });
  await check('Dashboard : liste, coordonnées, bouton et absence de cache', async () => {
    const list = await http(adminJar, '/admin/whatsapp/admissions'); assert.equal(list.status, 200); assert.match(list.text, /Marie Validation/);
    const detail = await http(adminJar, '/admin/whatsapp/admissions/' + request.id); assert.equal(detail.status, 200); assert.match(detail.text, /marie.validation@example.test/); assert.match(detail.text, /Inscrire cet étudiant/); assert.match(detail.headers.get('cache-control'), /no-store/);
  });
  await check('Permissions HTTP : anonyme et étudiant interdits', async () => {
    assert.equal((await http({}, '/admin/whatsapp/admissions')).status, 302);
    const jar = await login(phones.student); assert.equal((await http(jar, '/admin/whatsapp/admissions')).status, 403);
    await http(jar, '/student/profile'); assert.equal((await http(jar, '/admin/whatsapp/admissions/' + request.id + '/update', { action: 'claim', _csrf: jar.csrf })).status, 403);
  });
  await check('Protection CSRF sur changement de statut', async () => { assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/update', { action: 'claim' })).status, 403); });
  await check('Prise en charge et modification coordonnées persistées', async () => {
    await http(adminJar, '/admin/whatsapp/admissions/' + request.id);
    assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/update', { action: 'claim', _csrf: adminJar.csrf })).status, 303);
    const row = await prisma.whatsAppAdmissionRequest.findUnique({ where: { id: request.id } }); assert.equal(row.status, 'PROCESSING'); assert.equal(row.assignedAdminId, admin.id);
    assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/update', { action: 'edit', fullName: 'Marie Validation', phoneNumber: phones.prospect, email: request.email, requestedLevel: 'BEGINNER', _csrf: adminJar.csrf })).status, 303);
    assert.equal(await prisma.whatsAppAdmissionEvent.count({ where: { requestId: request.id, action: 'IDENTITY_EDITED' } }), 1);
  });
  const conversion = { fullName: request.fullName, phoneNumber: request.phoneNumber, email: request.email, requestedLevel: request.requestedLevel, sessionId: String(session.id), groupId: String(group.id), academicLevel: 'LEVEL_1' };
  await check('Conversion refusée sans confirmation explicite', async () => { const r = await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/convert', { ...conversion, _csrf: adminJar.csrf }); assert.equal(r.status, 400); assert.equal(await prisma.enrollment.count(), 0); });
  await check('Inscrire cet étudiant : compte et inscription réels', async () => {
    const r = await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/convert', { ...conversion, confirm: 'on', _csrf: adminJar.csrf }); assert.equal(r.status, 200);
    // Never persist or print this response: contains a generated temporary password.
    const row = await prisma.whatsAppAdmissionRequest.findUnique({ where: { id: request.id }, include: { enrollment: true } }); assert.equal(row.status, 'ENROLLED'); assert.equal(row.enrollment.trainingSessionId, session.id); assert.equal(row.enrollment.registrationGroupId, group.id); assert.equal(row.enrollment.expectedTotalAmount.toString(), '60'); assert.equal(row.enrollment.status, 'TRIAL_ACTIVE');
    assert.equal(await prisma.user.count({ where: { phoneNumber: phones.prospect, mustChangePassword: true } }), 1); assert.ok(row.confirmationDraft);
  });
  await check('Conversion répétée : même compte et même inscription', async () => { const r = await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/convert', { ...conversion, confirm: 'on', _csrf: adminJar.csrf }); assert.equal(r.status, 303); assert.equal(await prisma.enrollment.count(), 1); assert.equal(await prisma.user.count({ where: { phoneNumber: phones.prospect } }), 1); });
  await check('Demande clôturée : édition refusée', async () => { assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + request.id + '/update', { action: 'edit', ...conversion, _csrf: adminJar.csrf })).status, 409); });
  await check('Annulation d’une demande distincte et conversion interdite', async () => {
    const conv = await prisma.whatsAppConversation.create({ data: { phoneNumber: '+243890001004' } });
    const other = await prisma.whatsAppAdmissionRequest.create({ data: { conversationId: conv.id, fullName: 'Demande Annulee', phoneNumber: conv.phoneNumber, email: 'annulation@example.test', requestedLevel: 'BEGINNER', sourceMessageId: 'cancel-' + run } });
    assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + other.id + '/update', { action: 'cancel', _csrf: adminJar.csrf })).status, 303);
    assert.equal((await prisma.whatsAppAdmissionRequest.findUnique({ where: { id: other.id } })).status, 'CANCELLED');
    assert.equal((await http(adminJar, '/admin/whatsapp/admissions/' + other.id + '/convert', { ...conversion, phoneNumber: other.phoneNumber, email: other.email, confirm: 'on', _csrf: adminJar.csrf })).status, 409);
  });
  const admissions = require('../src/services/whatsappAdmissionService');
  await check('Deux conversions concurrentes : une inscription', async () => {
    const conv = await prisma.whatsAppConversation.create({ data: { phoneNumber: '+243890001005' } });
    const other = await prisma.whatsAppAdmissionRequest.create({ data: { conversationId: conv.id, fullName: 'Concurrent Validation', phoneNumber: conv.phoneNumber, email: 'concurrent@example.test', requestedLevel: 'BEGINNER', sourceMessageId: 'concurrent-' + run } });
    const payload = { ...conversion, fullName: other.fullName, phoneNumber: other.phoneNumber, email: other.email, confirm: 'on', passwordHash };
    await Promise.all([admissions.convert(other.id, admin.id, payload), admissions.convert(other.id, admin.id, payload)]);
    const users = await prisma.user.findMany({ where: { phoneNumber: other.phoneNumber } }); assert.equal(users.length, 1); assert.equal(await prisma.enrollment.count({ where: { userId: users[0].id } }), 1);
  });
  await check('Simulation HTTP : aucun nouvel enregistrement métier', async () => {
    const before = await prisma.whatsAppAdmissionRequest.count(); await http(adminJar, '/admin/whatsapp/admissions/simulator');
    const r = await http(adminJar, '/admin/whatsapp/admissions/simulator', { reset: 'on', _csrf: adminJar.csrf }); assert.equal(r.status, 303); assert.equal(await prisma.whatsAppAdmissionRequest.count(), before);
  });
  // Commercial assertions use real catalog services, separate from the completed conversation.
  const { createConversationEngine } = require('../src/services/whatsappConversationEngine');
  const catalog = require('../src/services/publicCourseService'), registration = require('../src/services/registrationService');
  const engine = createConversationEngine({ admissions: require('../src/services/whatsappAdmissionJourney').createAdmissionJourney({ database: prisma, catalog, registration }) });
  async function answer(text) { return engine.handleMessage({ text, messageId: crypto.randomUUID(), phoneNumber: '+243890001006' }); }
  await check('Formations : trois niveaux, 48 séances, certificat conditionnel', async () => { const r = await answer('formations'); commercial.push({ input: 'formations', text: r.text }); assert.match(r.text, /Niveau 1 → Niveau 2 → Niveau 3/); assert.match(r.text, /48 séances/); assert.match(r.text, /Aucun certificat à la fin d’un seul niveau/); assert.doesNotMatch(r.text, /certification internationale accréditée/); });
  await check('Horaires : vendredi et samedi issus des créneaux SQL', async () => { const r = await answer('horaires'); commercial.push({ input: 'horaires', text: r.text }); assert.match(r.text, /vendredi et samedi/); assert.doesNotMatch(r.text, /Friday|Saturday/); });
  await check('Communication : cinq essais inclus dans le premier niveau', async () => { const r = await answer('tarifs'); assert.match(r.text, /(?:5|cinq).*séances.*(?:incluses?|premier niveau|niveau 1)/i); });
  await check('Communication : paiement minimum de 30 USD après essai', async () => { const r = await answer('tarifs'); assert.match(r.text, /30\s*USD/); });
  await check('Règle réelle de paiement : cinq présences, 29 puis 30 USD', async () => {
    const row = await prisma.whatsAppAdmissionRequest.findUnique({ where: { id: request.id } });
    for (let i = 0; i < 5; i++) {
      const m = await prisma.classMeeting.create({ data: { trainingSessionId: session.id, startsAt: new Date(Date.now() - (10 - i) * 86400000), endsAt: new Date(Date.now() - (10 - i) * 86400000 + 3600000), privateMeetingUrl: 'https://example.invalid/never-opened' } });
      await prisma.attendance.create({ data: { enrollmentId: row.enrollmentId, classMeetingId: m.id, status: 'PRESENT' } });
    }
    const access = require('../src/services/trialAccessService'); assert.equal((await access.calculateTrialAccess(row.enrollmentId)).allowed, false);
    await prisma.payment.create({ data: { reference: 'validation-29-' + run, provider: 'TEST_ONLY', amount: 29, baseAmount: 60, currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', enrollmentId: row.enrollmentId, courseId: course.id } });
    assert.equal((await access.calculateTrialAccess(row.enrollmentId)).allowed, false);
    await prisma.payment.create({ data: { reference: 'validation-1-' + run, provider: 'TEST_ONLY', amount: 1, baseAmount: 60, currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', enrollmentId: row.enrollmentId, courseId: course.id } });
    const restored = await access.calculateTrialAccess(row.enrollmentId); assert.equal(restored.accessStage, 'PARTIAL_ACCESS'); assert.equal(restored.nextSessionLimit, 10);
  });
  await check('Aucun envoi ni worker activé', async () => { assert.equal(process.env.WHATSAPP_ENABLED, 'false'); assert.equal(process.env.WHATSAPP_WORKERS_ENABLED, 'false'); assert.equal(await prisma.whatsAppConversationMessage.count({ where: { providerMessageId: { not: null }, direction: 'OUTBOUND' } }), 0); });
  fs.writeFileSync(path.join(out, 'commercial-transcript.json'), JSON.stringify(commercial, null, 2));
}
main().catch(error => { results.push({ name: 'Harness completion', status: 'FAIL', code: error.code || error.name, detail: String(error.message).slice(0, 700) }); }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (prisma) await prisma.$disconnect();
  const sessionStore = require.cache[require.resolve('../src/config/sessionStore')]; if (sessionStore) await sessionStore.exports.closeSessionStore();
  if (sql) await sql.end();
  fs.writeFileSync(path.join(out, 'admissions-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), target, results }, null, 2));
  console.log(JSON.stringify({ pass: results.filter(r => r.status === 'PASS').length, fail: results.filter(r => r.status === 'FAIL').length }));
  process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
});
