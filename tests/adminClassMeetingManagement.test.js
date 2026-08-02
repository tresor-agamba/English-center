const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const classMeetingService = require('../src/services/classMeetingService');
const attendanceService = require('../src/services/attendanceService');
const trialAccessService = require('../src/services/trialAccessService');

test('administration des séances et présences', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const hash = await bcrypt.hash('Seances@2026', 12);
  const userIds = [];
  let courseId;
  let session;
  let otherSession;
  let meeting;
  let student;
  let otherStudent;
  let enrollment;
  let otherEnrollment;
  let server;
  let baseUrl;

  async function createStudent(index) {
    const user = await prisma.user.create({
      data: {
        firstName: `Présence${index}`,
        lastName: 'Test',
        phoneNumber: `+2438${index}${suffix}`,
        passwordHash: hash,
        role: 'STUDENT',
      },
    });
    userIds.push(user.id);
    return user;
  }

  function meetingBody(overrides = {}) {
    return {
      trainingSessionId: String(session.id),
      title: 'Séance administrative',
      date: '2027-01-04',
      startTime: '18:00',
      endTime: '20:00',
      privateMeetingUrl: `https://zoom.example.test/private-${unique}`,
      status: 'SCHEDULED',
      ...overrides,
    };
  }

  try {
    const course = await prisma.course.create({
      data: {
        title: 'Gestion séances test',
        slug: `gestion-seances-${unique}`,
        price: '100.00',
        currency: 'USD',
        isPublished: true,
      },
    });
    courseId = course.id;
    session = await prisma.trainingSession.create({
      data: {
        name: 'Promotion principale',
        courseId,
        startDate: new Date('2027-01-01T00:00:00Z'),
        endDate: new Date('2027-03-31T23:59:00Z'),
        registrationDeadline: new Date('2026-12-30T00:00:00Z'),
        capacity: 10,
        weekDays: ['MONDAY', 'WEDNESDAY'],
        startTime: '18:00',
        endTime: '20:00',
        timezone: 'UTC',
        platform: 'Zoom',
        status: 'OPEN',
      },
    });
    otherSession = await prisma.trainingSession.create({
      data: {
        name: 'Autre promotion',
        courseId,
        startDate: new Date('2027-01-01T00:00:00Z'),
        endDate: new Date('2027-03-31T23:59:00Z'),
        registrationDeadline: new Date('2026-12-30T00:00:00Z'),
        capacity: 10,
        weekDays: ['MONDAY'],
        startTime: '18:00',
        endTime: '20:00',
        timezone: 'UTC',
        platform: 'Google Meet',
        status: 'OPEN',
      },
    });
    student = await createStudent(1);
    otherStudent = await createStudent(2);
    enrollment = await prisma.enrollment.create({
      data: { userId: student.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' },
    });
    otherEnrollment = await prisma.enrollment.create({
      data: { userId: otherStudent.id, trainingSessionId: otherSession.id, status: 'TRIAL_ACTIVE' },
    });

    await t.test('crée et modifie une séance valide dans le fuseau de la session', async () => {
      const data = await classMeetingService.buildMeetingData(meetingBody());
      meeting = await classMeetingService.create(data);
      assert.equal(meeting.trainingSessionId, session.id);
      assert.equal(meeting.startsAt.toISOString(), '2027-01-04T18:00:00.000Z');
      assert.equal(meeting.endsAt.toISOString(), '2027-01-04T20:00:00.000Z');
      assert.equal(meeting.status, 'SCHEDULED');

      const loaded = await classMeetingService.findById(meeting.id);
      const update = await classMeetingService.buildMeetingData(
        meetingBody({ title: 'Titre modifié', privateMeetingUrl: `https://meet.google.com/${unique}` }),
        loaded
      );
      const updated = await classMeetingService.update(meeting.id, update);
      assert.equal(updated.title, 'Titre modifié');
      assert.equal(updated.privateMeetingUrl, `https://meet.google.com/${unique}`);
    });

    await t.test('rejette session, période, jour, horaire, URL et doublon invalides', async () => {
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody({ trainingSessionId: '999999999' })),
        (error) => error.code === 'SESSION_NOT_FOUND'
      );
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody({ date: '2028-01-03' })),
        (error) => error.code === 'OUTSIDE_SESSION'
      );
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody({ date: '2027-01-05' })),
        (error) => error.code === 'INVALID_WEEKDAY'
      );
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody({ startTime: '20:00', endTime: '18:00' })),
        (error) => error.code === 'INVALID_TIME_RANGE'
      );
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody({ privateMeetingUrl: 'javascript:alert(1)' })),
        (error) => error.code === 'INVALID_URL'
      );
      await assert.rejects(
        classMeetingService.buildMeetingData(meetingBody()),
        (error) => error.code === 'DUPLICATE_MEETING'
      );
    });

    await t.test('affiche uniquement les étudiants de la bonne session', async () => {
      const sheet = await classMeetingService.getAttendanceSheet(meeting.id);
      assert.equal(sheet.rows.some((row) => row.id === enrollment.id), true);
      assert.equal(sheet.rows.some((row) => row.id === otherEnrollment.id), false);
      assert.equal(Object.hasOwn(sheet.rows[0].user, 'passwordHash'), false);
    });

    await t.test('enregistre et corrige les présences en lot sans doublon', async () => {
      const secondInSession = await createStudent(3);
      const secondEnrollment = await prisma.enrollment.create({
        data: { userId: secondInSession.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' },
      });
      await attendanceService.recordAttendanceBatch(meeting.id, [
        { enrollmentId: enrollment.id, status: 'PRESENT' },
        { enrollmentId: secondEnrollment.id, status: 'ABSENT' },
      ]);
      assert.equal(await prisma.attendance.count({ where: { classMeetingId: meeting.id } }), 2);

      await attendanceService.recordAttendanceBatch(meeting.id, [
        { enrollmentId: enrollment.id, status: 'EXCUSED' },
        { enrollmentId: secondEnrollment.id, status: 'PRESENT' },
      ]);
      assert.equal(await prisma.attendance.count({ where: { classMeetingId: meeting.id } }), 2);
      assert.equal(
        (await prisma.attendance.findUnique({
          where: { enrollmentId_classMeetingId: { enrollmentId: enrollment.id, classMeetingId: meeting.id } },
        })).status,
        'EXCUSED'
      );

      await assert.rejects(
        attendanceService.recordAttendanceBatch(meeting.id, [
          { enrollmentId: otherEnrollment.id, status: 'PRESENT' },
        ]),
        (error) => error.code === 'SESSION_MISMATCH'
      );
    });

    await t.test('déclenche le paiement requis puis exclut une séance annulée du compteur', async () => {
      const extraMeetings = [];
      for (const [date, title] of [
        ['2027-01-06', 'Séance 2'],
        ['2027-01-11', 'Séance 3'],
        ['2027-01-13', 'Séance 4'],
        ['2027-01-18', 'Séance 5'],
      ]) {
        const data = await classMeetingService.buildMeetingData(meetingBody({
          date,
          title,
          startTime: '18:00',
          endTime: '20:00',
          privateMeetingUrl: `https://zoom.example.test/${title.replace(' ', '-')}-${unique}`,
        }));
        extraMeetings.push(await classMeetingService.create(data));
      }
      await attendanceService.recordAttendance({
        enrollmentId: enrollment.id,
        classMeetingId: meeting.id,
        status: 'PRESENT',
      });
      for (const item of extraMeetings) {
        const sequence = extraMeetings.indexOf(item) + 1;
        await prisma.classMeeting.update({
          where: { id: item.id },
          data: {
            startsAt: new Date(Date.now() - (sequence + 1) * 120 * 60 * 1000),
            endsAt: new Date(Date.now() - (sequence + 1) * 120 * 60 * 1000 + 60 * 60 * 1000),
            status: 'COMPLETED',
          },
        });
        await attendanceService.recordAttendance({
          enrollmentId: enrollment.id,
          classMeetingId: item.id,
          status: 'PRESENT',
        });
      }
      await prisma.classMeeting.update({
        where: { id: meeting.id },
        data: {
          startsAt: new Date(Date.now() - 60 * 60 * 1000),
          endsAt: new Date(Date.now() - 30 * 60 * 1000),
          status: 'COMPLETED',
        },
      });
      assert.equal((await trialAccessService.calculateTrialAccess(enrollment.id)).enrollmentStatus, 'PAYMENT_REQUIRED');

      await classMeetingService.cancel(extraMeetings[0].id);
      const afterCancellation = await trialAccessService.calculateTrialAccess(enrollment.id);
      assert.equal(afterCancellation.trialAttendanceCount, 4);
      assert.equal(afterCancellation.enrollmentStatus, 'TRIAL_ACTIVE');
      assert.ok(await prisma.classMeeting.findUnique({ where: { id: extraMeetings[0].id } }));
      await assert.rejects(
        attendanceService.recordAttendance({
          enrollmentId: enrollment.id,
          classMeetingId: extraMeetings[0].id,
          status: 'ABSENT',
        }),
        (error) => error.code === 'MEETING_CANCELLED'
      );
    });

    await t.test('protège le changement de session si des présences existent', async () => {
      const loaded = await classMeetingService.findById(meeting.id);
      await assert.rejects(
        classMeetingService.buildMeetingData({
          ...meetingBody({
            trainingSessionId: String(otherSession.id),
            date: '2027-01-04',
          }),
        }, loaded),
        (error) => error.code === 'SESSION_CHANGE_FORBIDDEN'
      );
    });

    await t.test('applique la fenêtre centrale de trente minutes et les statuts', async () => {
      const createWindowMeeting = async (offsetStart, offsetEnd, status = 'SCHEDULED') =>
        prisma.classMeeting.create({
          data: {
            trainingSessionId: session.id,
            title: `Fenêtre ${offsetStart}`,
            startsAt: new Date(Date.now() + offsetStart * 60000),
            endsAt: new Date(Date.now() + offsetEnd * 60000),
            privateMeetingUrl: `https://zoom.example.test/window-${offsetStart}-${unique}`,
            status,
          },
        });

      const tooEarly = await createWindowMeeting(31, 90);
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(student.id, enrollment.id, tooEarly.id),
        (error) => error.code === 'MEETING_TOO_EARLY'
      );
      const available = await createWindowMeeting(10, 70);
      const access = await trialAccessService.canAccessClassMeeting(student.id, enrollment.id, available.id);
      assert.equal(access.allowed, true);
      const ended = await createWindowMeeting(-90, -1);
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(student.id, enrollment.id, ended.id),
        (error) => error.code === 'MEETING_ENDED'
      );
      const completed = await createWindowMeeting(5, 60, 'COMPLETED');
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(student.id, enrollment.id, completed.id),
        (error) => error.code === 'MEETING_UNAVAILABLE'
      );
      const cancelled = await createWindowMeeting(6, 60, 'CANCELLED');
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(student.id, enrollment.id, cancelled.id),
        (error) => error.code === 'MEETING_UNAVAILABLE'
      );
      assert.equal(trialAccessService.CLASS_JOIN_EARLY_MINUTES, 30);
    });

    await t.test('protège toutes les routes administratives', async () => {
      server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      for (const path of [
        '/admin/class-meetings',
        '/admin/class-meetings/new',
        `/admin/class-meetings/${meeting.id}`,
        `/admin/class-meetings/${meeting.id}/edit`,
        `/admin/class-meetings/${meeting.id}/attendance`,
      ]) {
        const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/login');
      }
      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        body: new URLSearchParams({ phoneNumber: student.phoneNumber, password: 'Seances@2026' }),
        redirect: 'manual',
      });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const forbidden = await fetch(`${baseUrl}/admin/class-meetings/${meeting.id}/cancel`, {
        method: 'POST',
        headers: { Cookie: cookie },
      });
      assert.equal(forbidden.status, 403);
    });

    await t.test('ne publie jamais le lien privé', async () => {
      const response = await fetch(`${baseUrl}/formations/${(await prisma.course.findUnique({ where: { id: courseId } })).slug}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.doesNotMatch(html, /zoom\.example\.test\/private/);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (courseId) await prisma.course.delete({ where: { id: courseId } }).catch(() => {});
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
