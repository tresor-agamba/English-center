const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const registrationService = require('../src/services/registrationService');

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

test('inscription d’un étudiant existant', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const password = 'Etudiant@2026';
  const now = new Date();
  const userIds = [];
  let courseId;
  let server;
  let baseUrl;
  let student;
  let secondStudent;
  let validSession;
  let pendingSession;
  let confirmedSession;
  let cancelledEnrollmentSession;
  let failedEnrollmentSession;

  async function createUser(index) {
    const user = await prisma.user.create({
      data: {
        firstName: `Étudiant${index}`,
        lastName: 'Existant',
        phoneNumber: `+2438${index}${suffix}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'STUDENT',
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createSession(name, overrides = {}) {
    return prisma.trainingSession.create({
      data: {
        name,
        courseId,
        startDate: addDays(now, 12),
        endDate: addDays(now, 18),
        registrationDeadline: addDays(now, 10),
        capacity: 5,
        platform: 'Zoom',
        timezone: 'Africa/Kinshasa',
        status: 'OPEN',
        ...overrides,
      },
    });
  }

  async function login(user, sessionId) {
    const body = new URLSearchParams({
      phoneNumber: user.phoneNumber,
      password,
      sessionId: String(sessionId),
    });
    const response = await fetch(`${baseUrl}/login`, { method: 'POST', body, redirect: 'manual' });
    return {
      response,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }

  try {
    const course = await prisma.course.create({
      data: {
        title: 'Inscription existante contrôlée',
        slug: `inscription-existante-${unique}`,
        shortDescription: 'Formation entièrement en ligne',
        price: '75.00',
        currency: 'USD',
        trainingMode: 'En ligne',
        level: 'Intermédiaire',
        durationValue: 8,
        durationUnit: 'WEEKS',
        isPublished: true,
        lmsStatus: 'PUBLISHED',
        publishedAt: now,
      },
    });
    courseId = course.id;
    student = await createUser(1);
    secondStudent = await createUser(2);

    validSession = await createSession('Session à confirmer');
    pendingSession = await createSession('Session déjà en attente');
    confirmedSession = await createSession('Session déjà confirmée');
    cancelledEnrollmentSession = await createSession('Session à réactiver');
    failedEnrollmentSession = await createSession('Session paiement échoué');

    await prisma.enrollment.createMany({
      data: [
        { userId: student.id, trainingSessionId: pendingSession.id, status: 'TRIAL_ACTIVE' },
        { userId: student.id, trainingSessionId: confirmedSession.id, status: 'CONFIRMED' },
        { userId: student.id, trainingSessionId: cancelledEnrollmentSession.id, status: 'CANCELLED' },
        { userId: student.id, trainingSessionId: failedEnrollmentSession.id, status: 'PAYMENT_FAILED' },
      ],
    });
    const paidEnrollment = await prisma.enrollment.findUnique({
      where: { userId_trainingSessionId: { userId: student.id, trainingSessionId: confirmedSession.id } },
    });
    await prisma.payment.create({
      data: {
        reference: `EXISTING-PAID-${unique}`, provider: 'TEST', amount: '75', baseAmount: '75',
        currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', paidAt: now,
        enrollmentId: paidEnrollment.id, courseId,
      },
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('redirige le visiteur vers login en conservant la session', async () => {
      const response = await fetch(`${baseUrl}/enroll?session=${validSession.id}`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), `/login?session=${validSession.id}`);

      const loginPage = await fetch(`${baseUrl}/login?session=${validSession.id}`);
      const html = await loginPage.text();
      assert.match(html, new RegExp(`name="sessionId" value="${validSession.id}"`));
      assert.match(html, /href="\/formations"/);
      assert.doesNotMatch(html, new RegExp(`/register\\?session=${validSession.id}`));
    });

    let cookie;
    await t.test('redirige vers la confirmation après connexion', async () => {
      const result = await login(student, validSession.id);
      cookie = result.cookie;
      assert.equal(result.response.status, 302);
      assert.equal(result.response.headers.get('location'), `/enroll?session=${validSession.id}`);

      const confirmation = await fetch(`${baseUrl}/enroll?session=${validSession.id}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(confirmation.status, 200);
      const html = await confirmation.text();
      assert.match(html, /Formation 100 % en ligne/);
      assert.match(html, /Zoom/);
      assert.match(html, /Africa\/Kinshasa/);
      assert.doesNotMatch(html, new RegExp(student.passwordHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    let createdEnrollment;
    await t.test('inscrit uniquement l’utilisateur de la session Express', async () => {
      const body = new URLSearchParams({
        sessionId: String(validSession.id),
        userId: String(secondStudent.id),
        status: 'CONFIRMED',
        price: '0',
      });
      const response = await fetch(`${baseUrl}/enroll`, {
        method: 'POST',
        body,
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      assert.equal(response.status, 302);
      createdEnrollment = await prisma.enrollment.findUnique({
        where: { userId_trainingSessionId: { userId: student.id, trainingSessionId: validSession.id } },
      });
      assert.ok(createdEnrollment);
      assert.equal(createdEnrollment.userId, student.id);
      assert.equal(createdEnrollment.status, 'TRIAL_ACTIVE');
      assert.equal(
        await prisma.enrollment.count({ where: { userId: secondStudent.id, trainingSessionId: validSession.id } }),
        0
      );
    });

    await t.test('redirige les inscriptions en attente ou confirmées vers leur récapitulatif', async () => {
      for (const [session, expectedLabel] of [
        [pendingSession, 'Inscription gratuite active'],
        [confirmedSession, 'Inscription confirmée'],
      ]) {
        const enrollment = await prisma.enrollment.findUnique({
          where: { userId_trainingSessionId: { userId: student.id, trainingSessionId: session.id } },
        });
        const response = await fetch(`${baseUrl}/enroll?session=${session.id}`, {
          headers: { Cookie: cookie },
          redirect: 'manual',
        });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), `/registration/success/${enrollment.id}`);
        const summary = await fetch(`${baseUrl}${response.headers.get('location')}`, {
          headers: { Cookie: cookie },
        });
        assert.equal(summary.status, 200);
        assert.match(await summary.text(), new RegExp(expectedLabel));
      }
    });

    await t.test('réactive CANCELLED et PAYMENT_FAILED sans créer une seconde ligne', async () => {
      for (const session of [cancelledEnrollmentSession, failedEnrollmentSession]) {
        const before = await prisma.enrollment.findUnique({
          where: { userId_trainingSessionId: { userId: student.id, trainingSessionId: session.id } },
        });
        const result = await registrationService.enrollExistingStudent({ userId: student.id, sessionId: session.id });
        const after = await prisma.enrollment.findUnique({ where: { id: before.id } });
        assert.equal(result.reactivated, true);
        assert.equal(after.id, before.id);
        assert.equal(after.status, 'TRIAL_ACTIVE');
        assert.equal(
          await prisma.enrollment.count({ where: { userId: student.id, trainingSessionId: session.id } }),
          1
        );
      }
    });

    await t.test('rejette les sessions invalides avant et pendant la création', async () => {
      const past = await createSession('Passée', {
        startDate: addDays(now, -5),
        endDate: addDays(now, -1),
        registrationDeadline: addDays(now, -6),
      });
      const cancelled = await createSession('Annulée', { status: 'CANCELLED' });
      const expired = await createSession('Clôturée', { registrationDeadline: addDays(now, -1) });
      const full = await createSession('Complète', { capacity: 1 });
      await prisma.enrollment.create({
        data: { userId: secondStudent.id, trainingSessionId: full.id, status: 'CONFIRMED' },
      });

      for (const [session, code] of [
        [past, 'SESSION_UNAVAILABLE'],
        [cancelled, 'SESSION_UNAVAILABLE'],
        [expired, 'REGISTRATION_CLOSED'],
        [full, 'SESSION_FULL'],
      ]) {
        await assert.rejects(
          registrationService.enrollExistingStudent({ userId: student.id, sessionId: session.id }),
          (error) => error.code === code
        );
      }
      await assert.rejects(
        registrationService.enrollExistingStudent({ userId: student.id, sessionId: 999999999 }),
        (error) => error.code === 'SESSION_NOT_FOUND'
      );
    });

    await t.test('empêche le dépassement concurrent de capacité', async () => {
      const concurrent = await createSession('Dernière place', { capacity: 1 });
      const results = await Promise.allSettled([
        registrationService.enrollExistingStudent({ userId: student.id, sessionId: concurrent.id }),
        registrationService.enrollExistingStudent({ userId: secondStudent.id, sessionId: concurrent.id }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(
        await prisma.enrollment.count({
          where: {
            trainingSessionId: concurrent.id,
            status: { in: registrationService.OCCUPYING_STATUSES },
          },
        }),
        1
      );
    });

    await t.test('n’accepte aucune redirection externe', async () => {
      const body = new URLSearchParams({
        phoneNumber: student.phoneNumber,
        password,
        sessionId: 'https://example.com/steal',
        redirect: 'https://example.com/steal',
      });
      const response = await fetch(`${baseUrl}/login`, { method: 'POST', body, redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/student');
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
