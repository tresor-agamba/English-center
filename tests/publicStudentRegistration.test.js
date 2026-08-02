require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const authService = require('../src/services/authService');
const registration = require('../src/services/registrationService');
const placement = require('../src/services/placementTestService');
const trialAccess = require('../src/services/trialAccessService');
const { normalizePhoneNumber } = require('../src/utils/phone.util');

const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

test('parcours public étudiant par formation et niveau', async (t) => {
  const key = `${Date.now()}${process.pid}`;
  const suffix = key.slice(-7);
  const password = 'Etudiant@2026';
  const now = new Date();
  let server;
  let course;
  let hiddenCourse;

  async function createCourse(title, published = true) {
    const item = await prisma.course.create({
      data: { title, slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${key}`,
        shortDescription: 'Formation publique complète', level: 'Intermédiaire',
        durationValue: 8, durationUnit: 'WEEKS', price: '100', currency: 'USD',
        pricingMode: 'ONE_TIME', pricingActive: true, isPublished: published,
        lmsStatus: published ? 'PUBLISHED' : 'DRAFT', publishedAt: published ? now : null },
    });
    await prisma.trainingSession.create({
      data: {
        name: `Session ${title}`, courseId: item.id, startDate: addDays(now, 20), endDate: addDays(now, 40),
        registrationDeadline: addDays(now, 15), capacity: 30, status: 'OPEN',
      },
    });
    return item;
  }

  async function register(data) {
    const phoneNumber = normalizePhoneNumber(data.phoneNumber);
    return registration.createRegistration({
      courseId: course.id,
      firstName: data.firstName || 'Public',
      lastName: data.lastName || 'Student',
      phoneNumber,
      email: data.email || null,
      passwordHash: await bcrypt.hash(password, 12),
      requestedLevel: data.requestedLevel,
      role: data.role,
    });
  }

  try {
    course = await createCourse('Formation publique');
    hiddenCourse = await createCourse('Formation inactive', false);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    await t.test('affiche le formulaire public et les boutons S’inscrire', async () => {
      const registerPage = await fetch(`${base}/register`);
      assert.equal(registerPage.status, 200);
      const form = await registerPage.text();
      assert.match(form, /Full name|Nom complet/); assert.match(form, /Email address|Adresse email/);
      assert.match(form, /LEVEL_1/); assert.match(form, /LEVEL_2/); assert.match(form, /LEVEL_3/);
      for (const path of ['/', '/formations']) {
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Register|S’inscrire/);
      }
    });

    let level1NoEmail;
    await t.test('inscrit LEVEL_1 sans email, normalise le téléphone et force STUDENT', async () => {
      level1NoEmail = await register({ phoneNumber: `082${suffix}`, requestedLevel: 'LEVEL_1', role: 'ADMIN' });
      const user = await prisma.user.findUnique({ where: { id: level1NoEmail.user.id } });
      const enrollment = await prisma.enrollment.findUnique({ where: { id: level1NoEmail.enrollment.id } });
      assert.equal(user.phoneNumber, `+24382${suffix}`);
      assert.equal(user.email, null); assert.equal(user.role, 'STUDENT');
      assert.equal(enrollment.requestedLevel, 'LEVEL_1');
      assert.equal(enrollment.recommendedLevel, 'LEVEL_1');
      assert.equal(enrollment.approvedLevel, 'LEVEL_1');
      assert.equal(enrollment.placementTestRequired, false);
      assert.equal(enrollment.status, 'TRIAL_ACTIVE');
    });

    let level1Email;
    await t.test('inscrit LEVEL_1 avec email normalisé', async () => {
      level1Email = await register({ phoneNumber: `083${suffix}`, email: `  PUBLIC-${key}@Example.COM `, requestedLevel: 'LEVEL_1' });
      const user = await prisma.user.findUnique({ where: { id: level1Email.user.id } });
      assert.equal(user.email, `public-${key}@example.com`);
    });

    let level2;
    await t.test('inscrit LEVEL_2 sans email et bloque la formation avant le test', async () => {
      level2 = await register({ phoneNumber: `084${suffix}`, requestedLevel: 'LEVEL_2', role: 'TEACHER' });
      const enrollment = await prisma.enrollment.findUnique({ where: { id: level2.enrollment.id } });
      assert.equal(level2.user.role, 'STUDENT');
      assert.equal(enrollment.requestedLevel, 'LEVEL_2');
      assert.equal(enrollment.approvedLevel, null);
      assert.equal(enrollment.placementTestRequired, true);
      assert.equal(enrollment.status, 'PLACEMENT_TEST_REQUIRED');
      assert.equal((await trialAccess.getLearningOverview(enrollment.id)).trialAccess.hasCourseAccess, false);
    });

    let level3;
    await t.test('inscrit LEVEL_3 sans email en attente du test', async () => {
      level3 = await register({ phoneNumber: `085${suffix}`, requestedLevel: 'LEVEL_3' });
      const enrollment = await prisma.enrollment.findUnique({ where: { id: level3.enrollment.id } });
      assert.equal(enrollment.requestedLevel, 'LEVEL_3');
      assert.equal(enrollment.recommendedLevel, null);
      assert.equal(enrollment.approvedLevel, null);
      assert.equal(enrollment.status, 'PLACEMENT_TEST_REQUIRED');
    });

    await t.test('refuse téléphone vide, niveau invalide et mots de passe différents', () => {
      assert.throws(() => normalizePhoneNumber(''), /invalide/i);
      assert.throws(() => registration.validateLevel('ADMIN'), /niveau/i);
      const controller = require('../src/controllers/registrationController');
      assert.throws(() => controller.validatePassword('abcdefgh', 'abcdefgi'), /correspondent/i);
    });

    await t.test('refuse un doublon de téléphone sous un autre format', async () => {
      await assert.rejects(
        register({ phoneNumber: `24382${suffix}`, requestedLevel: 'LEVEL_1' }),
        (error) => error.code === 'DUPLICATE_ENROLLMENT'
      );
    });

    await t.test('refuse email invalide et doublon email seulement lorsqu’il est fourni', async () => {
      const controller = require('../src/controllers/registrationController');
      assert.throws(() => controller.cleanForm({
        fullName: 'Email Invalide', phoneNumber: `086${suffix}`, email: 'incorrect',
        courseId: course.id, requestedLevel: 'LEVEL_1',
      }), /email invalide/i);
      await assert.rejects(
        register({ phoneNumber: `086${suffix}`, email: `public-${key}@example.com`, requestedLevel: 'LEVEL_1' }),
        (error) => error.code === 'EMAIL_EXISTS'
      );
    });

    await t.test('refuse formation inexistante ou inactive sans donnée partielle', async () => {
      for (const courseId of [999999999, hiddenCourse.id]) {
        const phoneNumber = normalizePhoneNumber(`087${String(courseId).slice(-7).padStart(7, '0')}`);
        await assert.rejects(
          registration.createRegistration({
            courseId, firstName: 'Transaction', lastName: 'Atomique', phoneNumber,
            passwordHash: await bcrypt.hash(password, 12), requestedLevel: 'LEVEL_1',
          }),
          (error) => error.code === 'COURSE_UNAVAILABLE'
        );
        assert.equal(await prisma.user.count({ where: { phoneNumber } }), 0);
      }
    });

    await t.test('calcule les seuils centralisés et oriente vers un niveau inférieur', () => {
      assert.equal(placement.recommendedLevel(49), 'LEVEL_1');
      assert.equal(placement.recommendedLevel(50), 'LEVEL_2');
      assert.equal(placement.recommendedLevel(74), 'LEVEL_2');
      assert.equal(placement.recommendedLevel(75), 'LEVEL_3');
    });

    await t.test('conserve LEVEL_3 demandé et approuve LEVEL_2 après résultat moyen', async () => {
      const result = await placement.completePlacement({ enrollmentId: level3.enrollment.id, studentId: level3.user.id, score: 60 });
      assert.equal(result.requestedLevel, 'LEVEL_3');
      assert.equal(result.recommendedLevel, 'LEVEL_2');
      assert.equal(result.approvedLevel, 'LEVEL_2');
      assert.equal(result.status, 'TRIAL_ACTIVE');
    });

    await t.test('oriente LEVEL_3 vers LEVEL_1 et LEVEL_2 vers LEVEL_1', async () => {
      const anotherLevel3 = await register({ phoneNumber: `088${suffix}`, requestedLevel: 'LEVEL_3' });
      const low3 = await placement.completePlacement({ enrollmentId: anotherLevel3.enrollment.id, studentId: anotherLevel3.user.id, score: 20 });
      const low2 = await placement.completePlacement({ enrollmentId: level2.enrollment.id, studentId: level2.user.id, score: 40 });
      assert.equal(low3.requestedLevel, 'LEVEL_3'); assert.equal(low3.approvedLevel, 'LEVEL_1');
      assert.equal(low2.requestedLevel, 'LEVEL_2'); assert.equal(low2.approvedLevel, 'LEVEL_1');
    });

    await t.test('connecte avec téléphone normalisé et mot de passe', async () => {
      const user = await authService.authenticate(`082${suffix}`, password);
      assert.equal(user.id, level1NoEmail.user.id);
      assert.equal(user.role, 'STUDENT');
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (course) await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    if (hiddenCourse) await prisma.course.delete({ where: { id: hiddenCourse.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { phoneNumber: { endsWith: suffix } } }).catch(() => {});
    await prisma.$disconnect();
  }
});
