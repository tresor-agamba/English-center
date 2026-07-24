const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const attendanceService = require('../src/services/attendanceService');
const trialAccessService = require('../src/services/trialAccessService');
const registrationService = require('../src/services/registrationService');
const paymentService = require('../src/services/paymentService');

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

test('essai gratuit limité à trois présences', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const password = 'EssaiGratuit@2026';
  const hash = await bcrypt.hash(password, 12);
  const now = new Date();
  const userIds = [];
  let courseId;
  let sessionId;
  let enrollment;
  let student;
  let server;
  let baseUrl;
  let cookie;
  const meetings = [];

  async function createStudent(index) {
    const user = await prisma.user.create({
      data: {
        firstName: `Essai${index}`,
        lastName: 'Test',
        phoneNumber: `+2438${index}${suffix}`,
        passwordHash: hash,
        role: 'STUDENT',
      },
    });
    userIds.push(user.id);
    return user;
  }

  try {
    const course = await prisma.course.create({
      data: {
        title: 'Formation essai gratuit',
        slug: `essai-gratuit-${unique}`,
        price: '120.00',
        currency: 'USD',
        isPublished: true,
      },
    });
    courseId = course.id;
    const session = await prisma.trainingSession.create({
      data: {
        name: 'Promotion essai gratuit',
        courseId,
        startDate: addDays(now, 10),
        endDate: addDays(now, 40),
        registrationDeadline: addDays(now, 8),
        capacity: 10,
        status: 'OPEN',
      },
    });
    sessionId = session.id;
    for (let index = 0; index < 4; index += 1) {
      meetings.push(await prisma.classMeeting.create({
        data: {
          title: `Séance ${index + 1}`,
          startsAt: addDays(now, 10 + index * 2),
          endsAt: addDays(now, 10 + index * 2 + 0.1),
          privateMeetingUrl: `https://meet.example.test/private-${unique}-${index}`,
          trainingSessionId: session.id,
        },
      }));
    }
    student = await createStudent(1);
    enrollment = await prisma.enrollment.create({
      data: { userId: student.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' },
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      body: new URLSearchParams({ phoneNumber: student.phoneNumber, password }),
      redirect: 'manual',
    });
    cookie = login.headers.get('set-cookie').split(';')[0];

    await t.test('autorise l’accès avant puis après une et deux présences', async () => {
      let access = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.deepEqual(
        {
          count: access.trialAttendanceCount,
          remaining: access.remainingTrialAttendances,
          allowed: access.hasCourseAccess,
          status: access.enrollmentStatus,
        },
        { count: 0, remaining: 3, allowed: true, status: 'TRIAL_ACTIVE' }
      );

      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[0].id,
        status: 'PRESENT',
      });
      access = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(access.trialAttendanceCount, 1);
      assert.equal(access.hasCourseAccess, true);

      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[1].id,
        status: 'PRESENT',
      });
      access = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(access.trialAttendanceCount, 2);
      assert.equal(access.remainingTrialAttendances, 1);
      assert.equal(access.hasCourseAccess, true);
    });

    await t.test('ne compte ni ABSENT ni EXCUSED', async () => {
      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[2].id,
        status: 'ABSENT',
      });
      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[3].id,
        status: 'EXCUSED',
      });
      const access = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(access.trialAttendanceCount, 2);
      assert.equal(access.enrollmentStatus, 'TRIAL_ACTIVE');
    });

    await t.test('passe à PAYMENT_REQUIRED à la troisième présence et bloque le lien', async () => {
      const result = await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[2].id,
        status: 'PRESENT',
      });
      assert.equal(result.trialAccess.trialAttendanceCount, 3);
      assert.equal(result.trialAccess.enrollmentStatus, 'PAYMENT_REQUIRED');
      assert.equal(result.trialAccess.hasCourseAccess, false);

      const denied = await trialAccessService.canAccessClassMeeting(student.id, enrollment.id, meetings[3].id);
      assert.equal(denied.allowed, false);
      assert.equal(Object.hasOwn(denied, 'meeting'), false);

      const page = await fetch(`${baseUrl}/registration/success/${enrollment.id}`, {
        headers: { Cookie: cookie },
      });
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /trois séances gratuites sont terminées/i);
      assert.match(html, /Accès bloqué/);
      assert.doesNotMatch(html, /meet\.example\.test/);

      const join = await fetch(`${baseUrl}/class-meetings/${meetings[3].id}/join?enrollment=${enrollment.id}`, {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      assert.equal(join.status, 403);
      assert.doesNotMatch(await join.text(), /meet\.example\.test/);
    });

    await t.test('corrige une présence sans doublon et réactive l’essai', async () => {
      const corrected = await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[2].id,
        status: 'EXCUSED',
      });
      assert.equal(corrected.trialAccess.trialAttendanceCount, 2);
      assert.equal(corrected.trialAccess.enrollmentStatus, 'TRIAL_ACTIVE');
      assert.equal(corrected.trialAccess.hasCourseAccess, true);
      assert.equal(
        await prisma.attendance.count({
          where: { enrollmentId: enrollment.id, classMeetingId: meetings[2].id },
        }),
        1
      );

      const allowed = await trialAccessService.canAccessClassMeeting(student.id, enrollment.id, meetings[3].id);
      assert.equal(allowed.allowed, true);
      assert.equal(allowed.meeting.privateMeetingUrl, meetings[3].privateMeetingUrl);
    });

    await t.test('valide la correspondance séance/session', async () => {
      const otherCourse = await prisma.course.create({
        data: { title: 'Autre essai', slug: `autre-essai-${unique}`, isPublished: true },
      });
      const otherSession = await prisma.trainingSession.create({
        data: {
          name: 'Autre promotion',
          courseId: otherCourse.id,
          startDate: addDays(now, 10),
          endDate: addDays(now, 20),
          registrationDeadline: addDays(now, 8),
          capacity: 2,
          status: 'OPEN',
        },
      });
      const otherMeeting = await prisma.classMeeting.create({
        data: {
          startsAt: addDays(now, 11),
          endsAt: addDays(now, 11.1),
          privateMeetingUrl: 'https://meet.example.test/other-private',
          trainingSessionId: otherSession.id,
        },
      });
      await assert.rejects(
        attendanceService.recordAttendance({
          enrollmentId: enrollment.id,
          classMeetingId: otherMeeting.id,
          status: 'PRESENT',
        }),
        (error) => error.code === 'SESSION_MISMATCH'
      );
      await prisma.course.delete({ where: { id: otherCourse.id } });
    });

    await t.test('empêche un étudiant de créer sa propre présence', async () => {
      const response = await fetch(`${baseUrl}/admin/attendances`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: new URLSearchParams({
          enrollmentId: String(enrollment.id),
          classMeetingId: String(meetings[3].id),
          status: 'PRESENT',
        }),
      });
      assert.equal(response.status, 403);
      assert.equal(
        await prisma.attendance.count({
          where: { enrollmentId: enrollment.id, classMeetingId: meetings[3].id, status: 'PRESENT' },
        }),
        0
      );
    });

    await t.test('autorise le paiement anticipé et rétablit l’accès après succès', async () => {
      const earlyPayment = await paymentService.createPaymentAttempt({
        userId: student.id,
        enrollmentId: enrollment.id,
      });
      assert.ok(earlyPayment.paymentReference);
      await paymentService.simulateSuccess(earlyPayment.paymentReference, student.id);
      const confirmed = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(confirmed.enrollmentStatus, 'CONFIRMED');
      assert.equal(confirmed.hasCourseAccess, true);

      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meetings[2].id,
        status: 'PRESENT',
      });
      const stillConfirmed = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(stillConfirmed.trialAttendanceCount, 3);
      assert.equal(stillConfirmed.enrollmentStatus, 'CONFIRMED');
      assert.equal(stillConfirmed.hasCourseAccess, true);
    });

    await t.test('autorise le paiement lorsque PAYMENT_REQUIRED', async () => {
      const second = await createStudent(2);
      const secondEnrollment = await prisma.enrollment.create({
        data: { userId: second.id, trainingSessionId: sessionId, status: 'PAYMENT_REQUIRED' },
      });
      await prisma.trainingSession.update({
        where: { id: sessionId },
        data: {
          startDate: addDays(now, -10),
          registrationDeadline: addDays(now, -12),
          status: 'ONGOING',
        },
      });
      const attempt = await paymentService.createPaymentAttempt({
        userId: second.id,
        enrollmentId: secondEnrollment.id,
      });
      assert.ok(attempt.paymentReference);
      await prisma.trainingSession.update({
        where: { id: sessionId },
        data: {
          startDate: addDays(now, 10),
          registrationDeadline: addDays(now, 8),
          status: 'OPEN',
        },
      });
    });

    await t.test('compte les places selon les nouveaux statuts', async () => {
      const third = await createStudent(3);
      const fourth = await createStudent(4);
      const fifth = await createStudent(5);
      await prisma.enrollment.createMany({
        data: [
          { userId: third.id, trainingSessionId: sessionId, status: 'TRIAL_ACTIVE' },
          { userId: fourth.id, trainingSessionId: sessionId, status: 'PAYMENT_REQUIRED' },
          { userId: fifth.id, trainingSessionId: sessionId, status: 'CANCELLED' },
        ],
      });
      const available = await registrationService.getSessionForRegistration(sessionId);
      const occupying = await prisma.enrollment.count({
        where: {
          trainingSessionId: sessionId,
          status: { in: registrationService.OCCUPYING_STATUSES },
        },
      });
      assert.equal(available.remainingPlaces, 10 - occupying);
      assert.equal(registrationService.OCCUPYING_STATUSES.includes('CANCELLED'), false);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
