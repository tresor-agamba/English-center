const test = require('node:test');
const assert = require('node:assert/strict');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(new URL(process.env.DATABASE_URL).pathname, '/english_center_test');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const courses = require('../src/services/courseService');
const sessions = require('../src/services/trainingSessionService');
const registration = require('../src/services/registrationService');
const access = require('../src/services/trialAccessService');
const structure = require('../src/services/courseStructureService');
const controller = require('../src/controllers/adminCourseController');
const academic = require('../src/services/academicService');
const { buildPublicCourseCard } = require('../src/utils/publicCoursePresentation.util');

test('Structures commerciales SIMPLE et LEVEL_BASED', async t => {
  const key = `${Date.now()}-${process.pid}`, courseIds = [], users = [];
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = { title: 'Excel pratique', courseType: 'OTHER', level: '', structureType: 'SIMPLE', sessionCount: '8', durationValue: '12', durationUnit: 'HOURS', price: '40', pricingState: 'AVAILABLE', currency: 'USD', accessPolicy: 'FULL_PAYMENT', shortDescription: 'Formation pratique complète.' };
  const leveled = { ...body, title: 'Anglais général', structureType: 'LEVEL_BASED', numberOfLevels: '3', sessionCount: '16', durationValue: '24', price: '60' };
  let simple, levels, simpleSession, levelSession, legacy, learner, enrollment, adminJar;
  async function create(data) { const c = await courses.create({ ...controller.parseForm(data), slug: `programme-${courseIds.length}-${key}` }); courseIds.push(c.id); return c; }
  function sessionData(courseId, extra = {}) { return { courseId, name: 'Session octobre', startDate: new Date(Date.now()+864000000), endDate: new Date(Date.now()+8640000000), registrationDeadline: new Date(Date.now()+432000000), capacity: 25, status: 'OPEN', platform: 'Zoom', startTime: '10:00', endTime: '11:30', weekDays: ['MONDAY'], ...extra }; }
  async function http(path, jar = {}, data) {
    const response = await fetch(base + path, { redirect: 'manual', method: data ? 'POST' : 'GET', headers: { Cookie: `${jar.cookie || ''}; nva-language=fr` }, body: data ? new URLSearchParams({ _csrf: jar.csrf || '', ...data }) : undefined });
    const html = await response.text(); jar.cookie = response.headers.get('set-cookie')?.split(';')[0] || jar.cookie; jar.csrf = html.match(/name="_csrf" value="([^"]+)"/)?.[1] || jar.csrf;
    return { response, html };
  }
  try {
    await t.test('SIMPLE : 40 USD, 12 heures, 8 séances', async () => {
      simple = await create(body); const totals = structure.courseTotals(simple);
      assert.equal(totals.totalIndicativePrice, '40.00'); assert.equal(totals.totalDuration, 12); assert.equal(totals.totalSessions, 8); assert.equal(simple.numberOfLevels, null);
      assert.equal(totals.pricePerLevel, undefined);
    });
    await t.test('LEVEL_BASED : 180 USD indicatifs, 72 heures, 48 séances', async () => {
      levels = await create(leveled); const totals = structure.courseTotals(levels);
      assert.equal(totals.totalIndicativePrice, '180.00'); assert.equal(totals.totalDuration, 72); assert.equal(totals.totalSessions, 48); assert.equal(Number(totals.pricePerLevel), 60);
    });
    for (const [name, extra] of [
      ['structure inconnue', { structureType: 'UNKNOWN' }], ['simple avec niveaux', { numberOfLevels: '3' }], ['séances nulles', { sessionCount: '0' }], ['séances fractionnaires', { sessionCount: '2.5' }], ['durée nulle', { durationValue: '0' }], ['prix négatif', { price: '-1' }], ['gratuité séparée', { price: '0' }], ['règle anglaise incohérente', { accessPolicy: 'LEGACY_STAGED' }],
    ]) await t.test(`validation serveur : ${name}`, () => assert.throws(() => controller.parseForm({ ...body, ...extra }), error => error.statusCode === 400));
    for (const extra of [{ numberOfLevels: '' }, { numberOfLevels: '0' }, { numberOfLevels: '1.5' }, { sessionCount: '' }]) await t.test(`validation niveaux ${JSON.stringify(extra)}`, () => assert.throws(() => controller.parseForm({ ...leveled, ...extra })));
    await t.test('calcul monétaire décimal exact et un niveau accepté', () => {
      assert.equal(structure.courseTotals({ ...levels, price: '0.10', numberOfLevels: 3 }).totalIndicativePrice, '0.30');
      assert.equal(controller.parseForm({ ...leveled, numberOfLevels: '1' }).numberOfLevels, 1);
    });
    await t.test('session SIMPLE sans niveau', async () => { simpleSession = await sessions.create(sessionData(simple.id)); assert.equal(simpleSession.levelNumber, null); });
    await t.test('session niveau 1 et groupes existants', async () => {
      levelSession = await sessions.create(sessionData(levels.id, { levelNumber: 1 })); assert.equal(levelSession.levelNumber, 1);
      const group = await sessions.createRegistrationGroup({ trainingSessionId: levelSession.id, name: 'Matin', startTime: '10:00', endTime: '11:30', weekDays: ['MONDAY'], capacity: 10 });
      assert.equal((await sessions.findById(levelSession.id)).registrationGroups[0].id, group.id);
    });
    await t.test('refuse niveau absent, excessif et niveau sur SIMPLE', async () => {
      await assert.rejects(sessions.create(sessionData(levels.id)), /entier positif/);
      await assert.rejects(sessions.create(sessionData(levels.id, { levelNumber: 4 })), /dépasse/);
      await assert.rejects(sessions.create(sessionData(simple.id, { levelNumber: 1 })), /simple/);
      await assert.rejects(sessions.update(levelSession.id, { levelNumber: 4 }), /dépasse/);
    });
    await t.test('publication des deux structures sans ancien niveau descriptif obligatoire', async () => { await courses.publish(simple.id); await courses.publish(levels.id); });
    await t.test('catalogue et accueil : totaux et portée tarifaire explicites', async () => {
      for (const path of ['/formations', '/']) { const { response, html } = await http(path); assert.equal(response.status, 200); assert.match(html, /Prix par niveau/); assert.match(html, /data-amount="60"/); assert.match(html, /48/); assert.match(html, /72/); }
    });
    await t.test('détail par niveaux : niveaux 1–3 et tarif sans / course', async () => {
      const { response, html } = await http(`/formations/${levels.slug}`); assert.equal(response.status, 200); assert.match(html, /Le paiement s’effectue niveau par niveau/); assert.match(html, /data-amount="60/); assert.match(html, /data-value="72/); assert.doesNotMatch(html, /\/ course/);
      assert.equal((html.match(/<h2><span data-i18n="detail.level">Niveau<\/span> /g) || []).length, 3);
    });
    await t.test('détail SIMPLE : aucun par niveau et huit séances', async () => { const { html } = await http(`/formations/${simple.slug}`); assert.doesNotMatch(html, /\/ niveau|Prix par niveau|Parcours complet/); assert.match(html, /8<\/span> <span data-i18n="structure.sessions"/); });
    await t.test('inscription : session sélectionnée, aucune durée anglaise codée en dur', async () => {
      const { response, html } = await http(`/register?session=${levelSession.id}`); assert.equal(response.status, 200); assert.match(html, /data-level-number="1"/); assert.match(html, /data-price="60/); assert.match(html, /data-session-count="16"/);
      const { html: excel } = await http(`/register?session=${simpleSession.id}`); assert.match(excel, /data-session-count="8"/); assert.match(excel, /data-structure="SIMPLE"/);
    });
    await t.test('inscription Niveau 1 attend 60 USD et non 180', async () => {
      const group = (await sessions.findById(levelSession.id)).registrationGroups[0];
      const result = await registration.createStudentEnrollment({ sessionId: levelSession.id, courseId: levels.id, groupId: group.id, firstName: 'Learner', lastName: 'Structure', phoneNumber: `+24381${String(Date.now()).slice(-7)}`, passwordHash: 'unused-fixture', requestedLevel: 'LEVEL_1' });
      learner = result.user; users.push(learner.id); enrollment = await prisma.enrollment.findUnique({ where: { id: result.enrollment.id } });
      assert.equal(enrollment.expectedTotalAmount.toString(), '60'); assert.equal(enrollment.requestedLevel, 'LEVEL_1'); assert.equal(enrollment.status, 'PAYMENT_REQUIRED');
    });
    await t.test('aucun essai anglais pour FULL_PAYMENT, paiement partiel conservé', async () => {
      let state = await access.calculateTrialAccess(enrollment.id); assert.equal(state.allowed, false); assert.equal(state.freeSessionsLimit, 0); assert.equal(state.nextRequiredPaymentAmount.toString(), '60');
      await prisma.payment.create({ data: { reference: `structure-${key}`, enrollmentId: enrollment.id, courseId: levels.id, amount: '30', baseAmount: '60', currency: 'USD', pricingMode: 'ONE_TIME', provider: 'manual', status: 'SUCCESS', paidAt: new Date() } });
      state = await access.calculateTrialAccess(enrollment.id); assert.equal(state.allowed, false); assert.equal(state.remainingAmount.toString(), '30');
      await prisma.payment.create({ data: { reference: `structure-full-${key}`, enrollmentId: enrollment.id, courseId: levels.id, amount: '30', baseAmount: '60', currency: 'USD', pricingMode: 'ONE_TIME', provider: 'manual', status: 'SUCCESS', paidAt: new Date() } });
      state = await access.calculateTrialAccess(enrollment.id); assert.equal(state.allowed, true); assert.equal(state.nextSessionLimit, 16);
    });
    await t.test('modification tarif conserve instantané inscription et paiements', async () => {
      const payments = await prisma.payment.findMany({ where: { enrollmentId: enrollment.id }, orderBy: { id: 'asc' } });
      await courses.update(levels.id, { price: '70' });
      assert.equal((await prisma.enrollment.findUnique({ where: { id: enrollment.id } })).expectedTotalAmount.toString(), '60');
      assert.deepEqual(await prisma.payment.findMany({ where: { enrollmentId: enrollment.id }, orderBy: { id: 'asc' } }), payments);
      assert.equal((await access.calculateTrialAccess(enrollment.id)).expectedTotalAmount.toString(), '60');
    });
    await t.test('changements incompatibles bloqués après inscription', async () => {
      await assert.rejects(courses.update(levels.id, { structureType: 'SIMPLE', numberOfLevels: null }), /verrouillées/);
      await assert.rejects(courses.update(levels.id, { accessPolicy: 'LEGACY_STAGED' }), /verrouillées/);
      await assert.rejects(sessions.update(levelSession.id, { levelNumber: 2 }), /verrouillés/);
    });
    await t.test('quatre niveaux au catalogue, refus explicite du parcours incompatible', async () => {
      const four = await create({ ...leveled, title: 'Cybersécurité', numberOfLevels: '4' }); await courses.publish(four.id);
      const fourth = await sessions.create(sessionData(four.id, { levelNumber: 4 }));
      assert.equal(structure.courseTotals(four).numberOfLevels, 4);
      await assert.rejects(registration.getSessionForRegistration(fourth.id), e => e.code === 'ACADEMIC_LEVEL_UNSUPPORTED');
      await assert.rejects(academic.createCohort({ courseId: four.id, level: 'LEVEL_1' }), e => e.code === 'UNSUPPORTED_COURSE_LEVELS');
      const { response, html } = await http(`/formations/${four.slug}`); assert.equal(response.status, 200); assert.match(html, /Contactez l’administration/); assert.doesNotMatch(html, new RegExp('href="/register\\?session=' + fourth.id + '"'));
    });
    await t.test('anciennes formations : SIMPLE, règle historique et séances inconnues préservées', async () => {
      legacy = await prisma.course.create({ data: { title: 'Parcours historique', slug: `historique-${key}`, level: 'tous', price: '80', durationValue: 6, durationUnit: 'MONTHS', shortDescription: 'Ancienne formation.' } }); courseIds.push(legacy.id);
      assert.equal(legacy.structureType, 'SIMPLE'); assert.equal(legacy.accessPolicy, 'LEGACY_STAGED'); assert.equal(legacy.sessionCount, null);
      const old = await courses.update(legacy.id, { title: 'Parcours historique corrigé' }); assert.equal(old.price.toString(), '80'); assert.equal(old.durationValue, 6); assert.deepEqual(structure.accessLimits(old), { legacy: true, trial: 5, partial: 10, total: 16 });
    });
    await t.test('limites d’accès SIMPLE suivent ses huit séances', () => assert.deepEqual(structure.accessLimits(simple), { legacy: false, trial: 0, partial: 0, total: 8 }));
    await t.test('totaux entiers exacts au-delà de la précision Number', () => {
      assert.equal(structure.courseTotals({ ...levels, numberOfLevels: 2147483647, sessionCount: 2147483647 }).totalSessions, '4611686014132420609');
    });
    await t.test('niveau 2 générique : pas de quiz anglais imposé et session précise conservée', async () => {
      const second = await sessions.create(sessionData(levels.id, { levelNumber: 2 }));
      const result = await registration.createStudentEnrollment({ sessionId: second.id, courseId: levels.id, firstName: 'Second', lastName: 'Level', phoneNumber: `+24383${String(Date.now()).slice(-7)}`, passwordHash: 'unused-fixture' }); users.push(result.user.id);
      const saved = await prisma.enrollment.findUniqueOrThrow({ where: { id: result.enrollment.id } });
      assert.equal(saved.trainingSessionId, second.id); assert.equal(saved.approvedLevel, 'LEVEL_2'); assert.equal(saved.placementTestRequired, false); assert.equal(saved.status, 'PAYMENT_REQUIRED');
    });
    await t.test('niveau demandé incompatible avec la session refusé', async () => {
      await assert.rejects(registration.createStudentEnrollment({ sessionId: levelSession.id, courseId: levels.id, firstName: 'Wrong', lastName: 'Level', phoneNumber: `+24384${String(Date.now()).slice(-7)}`, passwordHash: 'unused-fixture', requestedLevel: 'LEVEL_2' }), error => error.code === 'LEVEL_MISMATCH');
    });
    await t.test('conversion sans sessions : champs niveaux effacés explicitement', async () => {
      const empty = await create({ ...leveled, title: 'Parcours adaptable' });
      const converted = await courses.update(empty.id, { structureType: 'SIMPLE', numberOfLevels: null });
      assert.equal(converted.structureType, 'SIMPLE'); assert.equal(converted.numberOfLevels, null);
    });
    await t.test('projection carte réutilisable', () => { const card = buildPublicCourseCard(levels); assert.equal(card.totals.totalSessions, 48); assert.equal(card.facts.find(f => f.labelKey === 'structure.pricePerLevel').amount, 60); });
    await t.test('formulaires ADMIN création et édition via HTTP', async () => {
      const password = 'StructureAdmin2026!';
      const admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Structure', phoneNumber: `+24382${String(Date.now()).slice(-7)}`, role: 'ADMIN', passwordHash: await require('../src/services/passwordService').hashPassword(password) } }); users.push(admin.id);
      adminJar = {}; await http('/login', adminJar); assert.equal((await http('/login', adminJar, { phoneNumber: admin.phoneNumber, password })).response.status, 302);
      const page = await http('/admin/courses/new', adminJar); assert.equal(page.response.status, 200); assert.match(page.html, /Structure de la formation/); assert.match(page.html, /data-structure-preview/);
      const title = `Bureautique ${key}`; const created = await http('/admin/courses', adminJar, { ...body, title }); assert.equal(created.response.status, 302);
      const saved = await prisma.course.findFirstOrThrow({ where: { title } }); courseIds.push(saved.id);
      await http(`/admin/courses/${saved.id}/edit`, adminJar);
      const edited = await http(`/admin/courses/${saved.id}`, adminJar, { ...body, title, price: '45' }); assert.equal(edited.response.status, 302); assert.equal((await courses.findById(saved.id)).price.toString(), '45');
      const bad = await http(`/admin/courses/${saved.id}`, adminJar, { ...body, title, numberOfLevels: '3' }); assert.equal(bad.response.status, 400);
    });
  } finally {
    await prisma.payment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.enrollment.deleteMany({ where: { trainingSession: { courseId: { in: courseIds } } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
