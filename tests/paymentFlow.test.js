const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const paymentService = require('../src/services/paymentService');

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

test('architecture interne des paiements', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const password = 'Paiement@2026';
  const now = new Date();
  const userIds = [];
  let courseId;
  let server;
  let baseUrl;
  let student;
  let otherStudent;
  let admin;
  let cookie;

  async function createUser(index) {
    const user = await prisma.user.create({
      data: {
        firstName: `Payeur${index}`,
        lastName: 'Test',
        phoneNumber: `+2439${index}${suffix}`,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'STUDENT',
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function createPendingEnrollment(userId, label) {
    const session = await prisma.trainingSession.create({
      data: {
        name: `Paiement ${label}`,
        courseId,
        startDate: addDays(now, 15),
        endDate: addDays(now, 20),
        registrationDeadline: addDays(now, 10),
        capacity: 10,
        status: 'OPEN',
      },
    });
    return prisma.enrollment.create({
      data: { userId, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' },
    });
  }

  async function login() {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      body: new URLSearchParams({ phoneNumber: student.phoneNumber, password }),
      redirect: 'manual',
    });
    cookie = response.headers.get('set-cookie').split(';')[0];
  }

  try {
    const course = await prisma.course.create({
      data: {
        title: 'Paiement formation test',
        slug: `paiement-${unique}`,
        price: '149.50',
        currency: 'USD',
        pricingMode: 'ONE_TIME',
        pricingActive: true,
        registrationFee: '0',
        isPublished: true,
      },
    });
    courseId = course.id;
    student = await createUser(1);
    otherStudent = await createUser(2);
    admin = await prisma.user.create({
      data: {
        firstName: 'Administrateur',
        lastName: 'Paiement',
        phoneNumber: `+24398${suffix}`,
        passwordHash: 'test',
        role: 'ADMIN',
      },
    });
    userIds.push(admin.id);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    await login();

    await t.test('génère des références cryptographiques distinctes', () => {
      const references = new Set(Array.from({ length: 100 }, () => paymentService.generateReference()));
      assert.equal(references.size, 100);
      for (const reference of references) assert.match(reference, /^ENG-\d{4}-[A-F0-9]{16}$/);
    });

    let firstEnrollment;
    let firstPayment;
    await t.test('crée un paiement partiel et refuse une devise falsifiée', async () => {
      firstEnrollment = await createPendingEnrollment(student.id, 'création');
      const fraudulent = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: new URLSearchParams({
          enrollmentId: String(firstEnrollment.id),
          amount: '30',
          currency: 'FAKE',
          userId: String(otherStudent.id),
          status: 'SUCCESS',
          providerReference: 'fraude',
        }),
        redirect: 'manual',
      });
      assert.equal(fraudulent.status, 400);
      const response = await fetch(`${baseUrl}/payments`, {
        method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({ enrollmentId: String(firstEnrollment.id), amount: '30', currency: 'USD' }),
        redirect: 'manual',
      });
      assert.equal(response.status, 302);
      const reference = response.headers.get('location').split('/').pop();
      firstPayment = await prisma.payment.findUnique({ where: { reference } });
      assert.equal(firstPayment.enrollmentId, firstEnrollment.id);
      assert.equal(Number(firstPayment.baseAmount), 149.5);
      assert.equal(Number(firstPayment.registrationFee), 0);
      assert.equal(Number(firstPayment.amount), 30);
      assert.equal(firstPayment.currency, 'USD');
      assert.equal(firstPayment.pricingMode, 'ONE_TIME');
      assert.equal(firstPayment.courseId, courseId);
      assert.equal(firstPayment.status, 'PENDING');
      assert.equal(firstPayment.provider, 'development');
      assert.equal(firstPayment.providerReference, null);
      assert.ok(firstPayment.expiresAt > firstPayment.createdAt);
      assert.equal(Math.round((firstPayment.expiresAt - firstPayment.createdAt) / 60000), 30);

      await prisma.course.update({ where: { id: courseId }, data: { price: '200.00', currency: 'CDF', registrationFee: '0' } });
      const unchanged = await prisma.payment.findUnique({ where: { id: firstPayment.id } });
      assert.equal(Number(unchanged.baseAmount), 149.5);
      assert.equal(Number(unchanged.registrationFee), 0);
      assert.equal(Number(unchanged.amount), 30);
      assert.equal(unchanged.currency, 'USD');
    });

    await t.test('réutilise une tentative active', async () => {
      const result = await paymentService.createPaymentAttempt({
        userId: student.id,
        enrollmentId: firstEnrollment.id,
      });
      assert.equal(result.paymentReference, firstPayment.reference);
      assert.equal(result.reused, true);
      assert.equal(await prisma.payment.count({ where: { enrollmentId: firstEnrollment.id } }), 1);
    });

    await t.test('refuse visiteur, administrateur, autre étudiant et inscription inexistante', async () => {
      const anonymous = await fetch(`${baseUrl}/payments`, {
        method: 'POST',
        body: new URLSearchParams({ enrollmentId: String(firstEnrollment.id) }),
        redirect: 'manual',
      });
      assert.equal(anonymous.status, 302);
      assert.equal(anonymous.headers.get('location'), '/login');

      await assert.rejects(
        paymentService.createPaymentAttempt({ userId: otherStudent.id, enrollmentId: firstEnrollment.id }),
        (error) => error.code === 'PAYMENT_FORBIDDEN'
      );
      await assert.rejects(
        paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: 999999999 }),
        (error) => error.code === 'ENROLLMENT_NOT_FOUND'
      );
      await assert.rejects(
        paymentService.createPaymentAttempt({ userId: admin.id, enrollmentId: firstEnrollment.id }),
        (error) => error.code === 'STUDENT_FORBIDDEN'
      );
    });

    await t.test('protège la page et ne transmet aucun secret', async () => {
      const own = await fetch(`${baseUrl}/payments/${firstPayment.reference}`, { headers: { Cookie: cookie } });
      assert.equal(own.status, 200);
      const html = await own.text();
      assert.match(html, new RegExp(firstPayment.reference));
      assert.doesNotMatch(html, new RegExp(student.passwordHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(html, /metadata/i);

      const otherEnrollment = await createPendingEnrollment(otherStudent.id, 'protection');
      const otherPaymentResult = await paymentService.createPaymentAttempt({
        userId: otherStudent.id,
        enrollmentId: otherEnrollment.id,
      });
      const forbidden = await fetch(`${baseUrl}/payments/${otherPaymentResult.paymentReference}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(forbidden.status, 403);
    });

    await t.test('simule le succès atomiquement et reste idempotent', async () => {
      const first = await paymentService.simulateSuccess(firstPayment.reference, student.id);
      const second = await paymentService.simulateSuccess(firstPayment.reference, student.id);
      assert.equal(first.enrollmentId, firstEnrollment.id);
      assert.equal(second.enrollmentId, firstEnrollment.id);
      const [payment, enrollment] = await Promise.all([
        prisma.payment.findUnique({ where: { id: firstPayment.id } }),
        prisma.enrollment.findUnique({ where: { id: firstEnrollment.id } }),
      ]);
      assert.equal(payment.status, 'SUCCESS');
      assert.ok(payment.paidAt);
      assert.equal(enrollment.status, 'TRIAL_ACTIVE');
      assert.equal(await prisma.payment.count({ where: { enrollmentId: firstEnrollment.id } }), 1);
      const finalAttempt = await paymentService.createPaymentAttempt({
        userId: student.id, enrollmentId: firstEnrollment.id, amount: '119.50', currency: 'USD',
      });
      await paymentService.simulateSuccess(finalAttempt.paymentReference, student.id);
      const noNewAttempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: firstEnrollment.id });
      assert.equal(noNewAttempt.redirectToEnrollment, true);
      assert.equal((await prisma.enrollment.findUnique({ where: { id: firstEnrollment.id } })).status, 'CONFIRMED');
    });

    await t.test('simule un échec et autorise une nouvelle tentative', async () => {
      const enrollment = await createPendingEnrollment(student.id, 'échec');
      const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      await paymentService.simulateFailure(attempt.paymentReference, student.id);
      const failed = await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } });
      const unchangedEnrollment = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
      assert.equal(failed.status, 'FAILED');
      assert.equal(failed.failureReason, 'Simulation de paiement échoué');
      assert.equal(unchangedEnrollment.status, 'TRIAL_ACTIVE');

      const retry = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      assert.notEqual(retry.paymentReference, attempt.paymentReference);
      assert.equal(await prisma.payment.count({ where: { enrollmentId: enrollment.id } }), 2);

      await prisma.payment.update({ where: { reference: retry.paymentReference }, data: { status: 'CANCELLED' } });
      const afterCancellation = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      assert.notEqual(afterCancellation.paymentReference, retry.paymentReference);
      assert.equal(await prisma.payment.count({ where: { enrollmentId: enrollment.id } }), 3);
    });

    await t.test('expire une tentative et refuse sa confirmation', async () => {
      const enrollment = await createPendingEnrollment(student.id, 'expiration');
      const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      await prisma.payment.update({
        where: { reference: attempt.paymentReference },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await assert.rejects(
        paymentService.simulateSuccess(attempt.paymentReference, student.id),
        (error) => error.code === 'PAYMENT_EXPIRED'
      );
      const expired = await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } });
      assert.equal(expired.status, 'EXPIRED');
      assert.equal((await prisma.enrollment.findUnique({ where: { id: enrollment.id } })).status, 'TRIAL_ACTIVE');
      const retry = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      assert.notEqual(retry.paymentReference, attempt.paymentReference);
    });

    await t.test('ne considère pas un statut confirmé sans paiement comme payé', async () => {
      const enrollment = await createPendingEnrollment(student.id, 'déjà confirmée');
      await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: 'CONFIRMED' } });
      const result = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: enrollment.id });
      assert.ok(result.paymentReference);
      assert.equal(await prisma.payment.count({ where: { enrollmentId: enrollment.id } }), 1);
    });

    await t.test('refuse formation gratuite, tarif absent, tarif inactif et formation non publiée', async () => {
      const freeEnrollment = await createPendingEnrollment(student.id, 'gratuite');
      await prisma.course.update({ where: { id: courseId }, data: { price: 0, registrationFee: 0, currency: 'USD', pricingMode: 'FREE', pricingActive: true, isPublished: true } });
      await assert.rejects(() => paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: freeEnrollment.id }), (error) => error.code === 'PRICING_MODE_UNSUPPORTED');
      assert.notEqual((await prisma.enrollment.findUnique({ where: { id: freeEnrollment.id } })).status, 'CONFIRMED');
      assert.equal(await prisma.payment.count({ where: { enrollmentId: freeEnrollment.id } }), 0);

      const unavailableEnrollment = await createPendingEnrollment(student.id, 'sans tarif');
      await prisma.course.update({ where: { id: courseId }, data: { price: null, pricingMode: null, pricingActive: true } });
      await assert.rejects(() => paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: unavailableEnrollment.id }), (error) => error.code === 'PRICE_UNAVAILABLE');

      const inactiveEnrollment = await createPendingEnrollment(student.id, 'inactif');
      await prisma.course.update({ where: { id: courseId }, data: { price: 100, pricingMode: 'ONE_TIME', pricingActive: false } });
      await assert.rejects(() => paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: inactiveEnrollment.id }), (error) => error.code === 'PRICE_INACTIVE');

      const unpublishedEnrollment = await createPendingEnrollment(student.id, 'non publiée');
      await prisma.course.update({ where: { id: courseId }, data: { pricingActive: true, isPublished: false } });
      await assert.rejects(() => paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: unpublishedEnrollment.id }), (error) => error.code === 'SESSION_UNAVAILABLE');
    });

    await t.test('désactive les simulations en production', () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        assert.throws(() => paymentService.assertDevelopmentSimulation(), (error) => error.code === 'SIMULATION_DISABLED' && error.statusCode === 404);
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    await prisma.$disconnect();
  }
});
