const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const accessService = require('../src/services/trialAccessService');
const attendanceService = require('../src/services/attendanceService');
const paymentService = require('../src/services/paymentService');

test('5 séances gratuites puis paliers cumulés de paiement à 50 % et 100 %', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const userIds = [];
  let course;
  let unrelatedCourse;
  const now = Date.now();

  async function student(index) {
    const row = await prisma.user.create({
      data: {
        firstName: 'Palier', lastName: `Étudiant${index}`,
        phoneNumber: `+24397${String(index).padStart(2, '0')}${String(Date.now()).slice(-6)}`,
        passwordHash: 'test', role: 'STUDENT',
      },
    });
    userIds.push(row.id);
    return row;
  }

  async function enrollmentFor(user, label) {
    const session = await prisma.trainingSession.create({
      data: {
        name: `Palier ${label} ${key}`, courseId: course.id,
        startDate: new Date(now - 30 * 86400000), endDate: new Date(now + 30 * 86400000),
        registrationDeadline: new Date(now - 31 * 86400000), capacity: 30, status: 'OPEN',
      },
    });
    const meetings = [];
    for (let index = 0; index < 16; index += 1) {
      const startsAt = index < 10
        ? new Date(now - (20 - index) * 3600000)
        : new Date(now + (index - 9) * 86400000);
      meetings.push(await prisma.classMeeting.create({
        data: {
          title: `Séance ${index + 1}`, startsAt, endsAt: new Date(startsAt.getTime() + 3600000),
          privateMeetingUrl: `https://meet.example.test/${key}-${label}-${index}`,
          trainingSessionId: session.id,
        },
      }));
    }
    const enrollment = await prisma.enrollment.create({
      data: {
        userId: user.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE',
        expectedTotalAmount: 100, expectedCurrency: 'USD',
      },
    });
    return { enrollment, meetings };
  }

  async function attend(enrollmentId, meetings, count) {
    for (const meeting of meetings.slice(0, count)) {
      await attendanceService.recordAttendance({ enrollmentId, classMeetingId: meeting.id, status: 'PRESENT' });
    }
  }

  async function payment(enrollmentId, amount, status = 'SUCCESS', currency = 'USD', courseId = course.id) {
    return prisma.payment.create({
      data: {
        reference: `STAGE-${key}-${enrollmentId}-${amount}-${status}-${Math.random()}`,
        provider: 'TEST', amount, baseAmount: 100, registrationFee: 0, currency,
        pricingMode: 'ONE_TIME', status, enrollmentId, courseId,
        paidAt: status === 'SUCCESS' ? new Date() : null,
      },
    });
  }

  try {
    course = await prisma.course.create({
      data: {
        title: `Formation payante ${key}`, slug: `formation-paliers-${key}`,
        price: 100, currency: 'USD', pricingMode: 'ONE_TIME', pricingActive: true,
        registrationFee: 0, isPublished: true,
      },
    });
    unrelatedCourse = await prisma.course.create({
      data: {
        title: `Formation sans lien ${key}`, slug: `formation-sans-lien-${key}`,
        price: 100, currency: 'USD', pricingMode: 'ONE_TIME', pricingActive: true,
        registrationFee: 0, isPublished: true,
      },
    });

    const firstUser = await student(1);
    const first = await enrollmentFor(firstUser, 'principal');

    await t.test('5 séances et 0 % payé : séance 6 bloquée', async () => {
      let access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.accessStage, 'FREE_TRIAL');
      assert.equal(access.allowed, true);
      await attend(first.enrollment.id, first.meetings, 5);
      access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.attendedSessionCount, 5);
      assert.equal(access.accessStage, 'PAYMENT_REQUIRED_50');
      assert.equal(access.allowed, false);
      assert.equal(access.nextRequiredPaymentAmount.toString(), '50');
    });

    await t.test('49 % bloque encore puis plusieurs paiements cumulés atteignant 50 % autorisent les séances 6 à 10', async () => {
      await payment(first.enrollment.id, 49);
      assert.equal((await accessService.calculateTrialAccess(first.enrollment.id)).accessStage, 'PAYMENT_REQUIRED_50');
      await payment(first.enrollment.id, 1);
      const access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.paidInFull, false);
      assert.equal(access.paidPercentage, 50);
      assert.equal(access.accessStage, 'PARTIAL_ACCESS');
      assert.equal(access.allowed, true);
      assert.equal(access.nextSessionLimit, 10);
    });

    await t.test('après 10 séances, 50 % puis 99 % bloquent la séance 11 et 100 % ouvre les séances 11 à 16', async () => {
      await attend(first.enrollment.id, first.meetings.slice(5), 5);
      let access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.attendedSessionCount, 10);
      assert.equal(access.accessStage, 'PAYMENT_REQUIRED_FULL');
      await payment(first.enrollment.id, 49);
      access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.paidPercentage, 99);
      assert.equal(access.allowed, false);
      await payment(first.enrollment.id, 1);
      access = await accessService.calculateTrialAccess(first.enrollment.id);
      assert.equal(access.accessStage, 'FULL_ACCESS');
      assert.equal(access.nextSessionLimit, 16);
      assert.ok(access.fullyPaidAt);
      const overview = await accessService.getLearningOverview(first.enrollment.id);
      assert.notEqual(overview.classMeetings[10].access.code, 'PAYMENT_REQUIRED');
      assert.notEqual(overview.classMeetings[15].access.code, 'PAYMENT_REQUIRED');
    });

    await t.test('paiement direct de 100 % donne immédiatement l’accès complet', async () => {
      const user = await student(2);
      const row = await enrollmentFor(user, 'direct');
      await payment(row.enrollment.id, 100);
      const access = await accessService.calculateTrialAccess(row.enrollment.id);
      assert.equal(access.accessStage, 'FULL_ACCESS');
      assert.equal(access.paidPercentage, 100);
    });

    await t.test('un paiement unique de exactement 50 % ouvre les séances 6 à 10', async () => {
      const user = await student(20);
      const row = await enrollmentFor(user, 'exactement-moitie');
      await attend(row.enrollment.id, row.meetings, 5);
      await payment(row.enrollment.id, 50);
      const access = await accessService.calculateTrialAccess(row.enrollment.id);
      assert.equal(access.accessStage, 'PARTIAL_ACCESS');
      assert.equal(access.nextSessionLimit, 10);
    });

    await t.test('le serveur accepte les paiements partiels, les cumule et refuse un montant supérieur au solde', async () => {
      const user = await student(3);
      const row = await enrollmentFor(user, 'cumul');
      const attempt = await paymentService.createPaymentAttempt({
        userId: user.id, enrollmentId: row.enrollment.id, amount: '30', currency: 'USD',
      });
      const stored = await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } });
      assert.equal(stored.amount.toString(), '30');
      await paymentService.simulateSuccess(attempt.paymentReference, user.id);
      assert.equal((await accessService.calculateTrialAccess(row.enrollment.id)).confirmedPaidAmount.toString(), '30');
      const secondAttempt = await paymentService.createPaymentAttempt({
        userId: user.id, enrollmentId: row.enrollment.id, amount: '20', currency: 'USD',
      });
      await paymentService.simulateSuccess(secondAttempt.paymentReference, user.id);
      assert.equal((await accessService.calculateTrialAccess(row.enrollment.id)).accessStage, 'PARTIAL_ACCESS');
      await assert.rejects(
        () => paymentService.createPaymentAttempt({ userId: user.id, enrollmentId: row.enrollment.id, amount: '51', currency: 'USD' }),
        (error) => error.code === 'PAYMENT_OVER_BALANCE'
      );

      const otherUser = await student(30);
      const otherRow = await enrollmentFor(otherUser, 'devise');
      await assert.rejects(
        () => paymentService.createPaymentAttempt({ userId: otherUser.id, enrollmentId: otherRow.enrollment.id, amount: '100', currency: 'CDF' }),
        (error) => error.code === 'PAYMENT_CURRENCY_INVALID'
      );
    });

    await t.test('mauvaise inscription, autre étudiant et statuts non confirmés sont ignorés', async () => {
      const owner = await student(4);
      const other = await student(5);
      const row = await enrollmentFor(owner, 'isolation');
      const foreign = await enrollmentFor(other, 'foreign');
      await payment(foreign.enrollment.id, 100);
      await payment(row.enrollment.id, 100, 'PENDING');
      await payment(row.enrollment.id, 100, 'FAILED');
      await payment(row.enrollment.id, 100, 'REFUNDED');
      await payment(row.enrollment.id, 100, 'SUCCESS', 'CDF');
      await payment(row.enrollment.id, 100, 'SUCCESS', 'USD', unrelatedCourse.id);
      const access = await accessService.calculateTrialAccess(row.enrollment.id);
      assert.equal(access.confirmedPaidAmount.toString(), '0');
      assert.equal(access.accessStage, 'FREE_TRIAL');
      assert.equal(access.paidInFull, false);
    });

    await t.test('absence, annulation, présence future et doublon ne sont pas comptés', async () => {
      const user = await student(6);
      const row = await enrollmentFor(user, 'presence');
      await attendanceService.recordAttendance({ enrollmentId: row.enrollment.id, classMeetingId: row.meetings[0].id, status: 'ABSENT' });
      await attendanceService.recordAttendance({ enrollmentId: row.enrollment.id, classMeetingId: row.meetings[1].id, status: 'PRESENT' });
      await attendanceService.recordAttendance({ enrollmentId: row.enrollment.id, classMeetingId: row.meetings[1].id, status: 'PRESENT' });
      await prisma.attendance.create({ data: { enrollmentId: row.enrollment.id, classMeetingId: row.meetings[10].id, status: 'PRESENT' } });
      await prisma.classMeeting.update({ where: { id: row.meetings[2].id }, data: { status: 'CANCELLED' } });
      const access = await accessService.calculateTrialAccess(row.enrollment.id);
      assert.equal(access.attendedSessionCount, 1);
      assert.equal(await prisma.attendance.count({ where: { enrollmentId: row.enrollment.id, classMeetingId: row.meetings[1].id } }), 1);
    });

    await t.test('URL directe refusée et aucun lien privé divulgué au palier bloqué', async () => {
      const user = await student(9);
      const row = await enrollmentFor(user, 'url-bloquee');
      await attend(row.enrollment.id, row.meetings, 5);
      const denied = await accessService.canAccessClassMeeting(
        user.id, row.enrollment.id, row.meetings[10].id
      );
      assert.equal(denied.allowed, false);
      assert.equal(Object.hasOwn(denied, 'meeting'), false);
    });

    await t.test('ancien tarif conservé après modification du cours', async () => {
      const user = await student(7);
      const row = await enrollmentFor(user, 'snapshot');
      await prisma.course.update({ where: { id: course.id }, data: { price: 200 } });
      const access = await accessService.calculateTrialAccess(row.enrollment.id);
      assert.equal(access.expectedTotalAmount.toString(), '100');
      await prisma.course.update({ where: { id: course.id }, data: { price: 100 } });
    });

    await t.test('niveau terminé après 16 présences et formation FREE refusée', async () => {
      const user = await student(8);
      const row = await enrollmentFor(user, 'termine');
      for (const [index, meeting] of row.meetings.slice(10).entries()) {
        const startsAt = new Date(now - (30 + index) * 3600000);
        await prisma.classMeeting.update({
          where: { id: meeting.id },
          data: { startsAt, endsAt: new Date(startsAt.getTime() + 3600000) },
        });
      }
      await attend(row.enrollment.id, row.meetings, 16);
      await payment(row.enrollment.id, 100);
      assert.equal((await accessService.calculateTrialAccess(row.enrollment.id)).accessStage, 'COMPLETED');
      await prisma.course.update({ where: { id: course.id }, data: { pricingMode: 'FREE' } });
      await assert.rejects(
        () => accessService.calculateTrialAccess(row.enrollment.id),
        (error) => error.code === 'PAID_COURSE_REQUIRED'
      );
      await prisma.course.update({ where: { id: course.id }, data: { pricingMode: 'ONE_TIME' } });
    });

    await t.test('inscription gratuite et limitée à 16 séances', async () => {
      assert.equal(Number(course.registrationFee), 0);
      const count = await prisma.classMeeting.count({ where: { trainingSessionId: first.enrollment.trainingSessionId, status: { not: 'CANCELLED' } } });
      assert.equal(count, 16);
    });
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (unrelatedCourse) await prisma.course.delete({ where: { id: unrelatedCourse.id } }).catch(() => {});
    if (course) await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
