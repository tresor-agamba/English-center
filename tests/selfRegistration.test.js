const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const registrationService = require('../src/services/registrationService');

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

test('inscription autonome à une session', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const digits = String(Date.now()).slice(-7);
  const registrationPhone = `089${digits}`;
  const normalizedPhone = `+24389${digits}`;
  const existingPhone = `+24388${digits}`;
  const otherPhone = `+24381${digits}`;
  const password = 'Inscription@2026';
  const now = new Date();
  let courseId;
  let existingUserId;
  let otherUserId;
  let validSessionId;
  let pastSessionId;
  let cancelledSessionId;
  let expiredSessionId;
  let fullSessionId;
  let enrollmentId;
  let server;
  let baseUrl;
  let authCookie;

  async function createSession(name, overrides = {}) {
    return prisma.trainingSession.create({
      data: {
        name,
        courseId,
        startDate: addDays(now, 15),
        endDate: addDays(now, 20),
        registrationDeadline: addDays(now, 10),
        capacity: 3,
        status: 'OPEN',
        ...overrides,
      },
    });
  }

  try {
    const course = await prisma.course.create({
      data: {
        title: 'Auto-inscription test',
        slug: `auto-inscription-${unique}`,
        description: 'Formation de test',
        price: '90.00',
        currency: 'USD',
        trainingMode: 'En ligne',
        isPublished: true,
      },
    });
    courseId = course.id;
    const hash = await bcrypt.hash('Existant@2026', 12);
    const existingUser = await prisma.user.create({
      data: { firstName: 'Compte', lastName: 'Existant', phoneNumber: existingPhone, passwordHash: hash, role: 'STUDENT' },
    });
    existingUserId = existingUser.id;
    const otherUser = await prisma.user.create({
      data: { firstName: 'Autre', lastName: 'Étudiant', phoneNumber: otherPhone, passwordHash: hash, role: 'STUDENT' },
    });
    otherUserId = otherUser.id;

    validSessionId = (await createSession('Session valide')).id;
    pastSessionId = (await createSession('Session passée', {
      startDate: addDays(now, -10),
      endDate: addDays(now, -5),
      registrationDeadline: addDays(now, -12),
    })).id;
    cancelledSessionId = (await createSession('Session annulée', { status: 'CANCELLED' })).id;
    expiredSessionId = (await createSession('Session clôturée', { registrationDeadline: addDays(now, -1) })).id;
    fullSessionId = (await createSession('Session complète', { capacity: 1 })).id;
    await prisma.enrollment.create({
      data: {
        userId: existingUserId,
        trainingSessionId: fullSessionId,
        status: 'CONFIRMED',
      },
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test('affiche le formulaire et refuse les sessions invalides', async () => {
      const valid = await fetch(`${baseUrl}/register?session=${validSessionId}`);
      assert.equal(valid.status, 200);
      const validHtml = await valid.text();
      assert.match(validHtml, /Session valide/);
      assert.match(validHtml, /Auto-inscription test/);

      const cases = [
        ['/register', 400, /sélectionner/i],
        ['/register?session=999999999', 404, /introuvable/i],
        [`/register?session=${pastSessionId}`, 400, /plus disponible/i],
        [`/register?session=${cancelledSessionId}`, 400, /plus disponible/i],
        [`/register?session=${expiredSessionId}`, 400, /date limite/i],
        [`/register?session=${fullSessionId}`, 400, /complète/i],
      ];
      for (const [url, status, pattern] of cases) {
        const response = await fetch(`${baseUrl}${url}`);
        assert.equal(response.status, status);
        assert.match(await response.text(), pattern);
      }
    });

    await t.test('rejette un téléphone existant sans modifier le compte', async () => {
      const before = await prisma.user.findUnique({ where: { id: existingUserId } });
      const body = new URLSearchParams({
        sessionId: String(validSessionId),
        firstName: 'Tentative',
        lastName: 'Doublon',
        phoneNumber: existingPhone,
        password: 'Nouveau@2026',
        passwordConfirmation: 'Nouveau@2026',
      });
      const response = await fetch(`${baseUrl}/register`, { method: 'POST', body });
      assert.equal(response.status, 400);
      const html = await response.text();
      assert.match(html, /Un compte existe déjà/);
      assert.match(html, new RegExp(`/login\\?session=${validSessionId}`));
      const after = await prisma.user.findUnique({ where: { id: existingUserId } });
      assert.equal(after.passwordHash, before.passwordHash);
      assert.equal(await prisma.enrollment.count({ where: { userId: existingUserId, trainingSessionId: validSessionId } }), 0);
    });

    await t.test('crée compte et inscription atomiquement puis connecte automatiquement', async () => {
      const body = new URLSearchParams({
        sessionId: String(validSessionId),
        firstName: 'Nouvel',
        lastName: 'Étudiant',
        phoneNumber: registrationPhone,
        password,
        passwordConfirmation: password,
        role: 'ADMIN',
        status: 'CONFIRMED',
      });
      const response = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        body,
        redirect: 'manual',
      });
      assert.equal(response.status, 302);
      authCookie = response.headers.get('set-cookie').split(';')[0];
      const location = response.headers.get('location');
      assert.match(location, /^\/registration\/success\/\d+$/);
      enrollmentId = Number(location.split('/').pop());

      const user = await prisma.user.findUnique({ where: { phoneNumber: normalizedPhone } });
      assert.ok(user);
      assert.equal(user.role, 'STUDENT');
      assert.equal(user.isActive, true);
      assert.equal(await bcrypt.compare(password, user.passwordHash), true);
      assert.notEqual(user.passwordHash, password);

      const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
      assert.equal(enrollment.userId, user.id);
      assert.equal(enrollment.trainingSessionId, validSessionId);
      assert.equal(enrollment.status, 'TRIAL_ACTIVE');

      const success = await fetch(`${baseUrl}${location}`, { headers: { Cookie: authCookie } });
      assert.equal(success.status, 200);
      const successHtml = await success.text();
      assert.match(successHtml, /Inscription gratuite active/);
      assert.doesNotMatch(successHtml, new RegExp(user.passwordHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    await t.test('rejette une double inscription et protège le récapitulatif', async () => {
      await assert.rejects(
        registrationService.createRegistration({
          sessionId: validSessionId,
          firstName: 'Nouvel',
          lastName: 'Étudiant',
          phoneNumber: normalizedPhone,
          passwordHash: await bcrypt.hash(password, 12),
        }),
        (error) => error.code === 'DUPLICATE_ENROLLMENT'
      );

      const anonymous = await fetch(`${baseUrl}/registration/success/${enrollmentId}`, { redirect: 'manual' });
      assert.equal(anonymous.status, 302);
      assert.equal(anonymous.headers.get('location'), '/login');

      const otherEnrollment = await prisma.enrollment.create({
        data: { userId: otherUserId, trainingSessionId: validSessionId, status: 'TRIAL_ACTIVE' },
      });
      const forbidden = await fetch(`${baseUrl}/registration/success/${otherEnrollment.id}`, {
        headers: { Cookie: authCookie },
      });
      assert.equal(forbidden.status, 403);
    });

    await t.test('compte seulement les statuts occupant une place', async () => {
      await prisma.enrollment.update({
        where: { id: enrollmentId },
        data: { status: 'CANCELLED' },
      });
      const session = await registrationService.getSessionForRegistration(validSessionId);
      assert.equal(session.remainingPlaces, 2);

      const cancelledCount = await prisma.enrollment.count({
        where: { trainingSessionId: validSessionId, status: 'CANCELLED' },
      });
      assert.equal(cancelledCount, 1);
    });

    await t.test('ne crée aucun compte lorsqu’une session est pleine', async () => {
      const atomicPhone = `+24382${digits}`;
      await assert.rejects(
        registrationService.createRegistration({
          sessionId: fullSessionId,
          firstName: 'Transaction',
          lastName: 'Atomique',
          phoneNumber: atomicPhone,
          passwordHash: await bcrypt.hash(password, 12),
        }),
        (error) => error.code === 'SESSION_FULL'
      );
      assert.equal(await prisma.user.count({ where: { phoneNumber: atomicPhone } }), 0);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    if (existingUserId) await prisma.user.delete({ where: { id: existingUserId } }).catch(() => {});
    if (otherUserId) await prisma.user.delete({ where: { id: otherUserId } }).catch(() => {});
    const registeredUser = await prisma.user.findUnique({ where: { phoneNumber: normalizedPhone } }).catch(() => null);
    if (registeredUser) await prisma.user.delete({ where: { id: registeredUser.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
