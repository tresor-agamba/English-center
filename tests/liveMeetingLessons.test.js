const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const classMeetingService = require('../src/services/classMeetingService');
const trialAccessService = require('../src/services/trialAccessService');

test('séances live liées au programme pédagogique', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const password = 'CoursLive@2026';
  const hash = await bcrypt.hash(password, 12);
  const users = [];
  const courses = [];
  let server;

  async function user(index, role = 'STUDENT') {
    const item = await prisma.user.create({
      data: {
        firstName: `Live${index}`, lastName: 'Test', phoneNumber: `+2438${index}${suffix}`,
        passwordHash: hash, role,
      },
    });
    users.push(item.id);
    return item;
  }

  async function course(label) {
    const item = await prisma.course.create({
      data: { title: `Live ${label}`, slug: `live-${label}-${key}`, price: '100', currency: 'USD', isPublished: true },
    });
    courses.push(item.id);
    return item;
  }

  async function login(baseUrl, account) {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST', body: new URLSearchParams({ phoneNumber: account.phoneNumber, password }), redirect: 'manual',
    });
    return response.headers.get('set-cookie')?.split(';')[0];
  }

  try {
    const admin = await user(1, 'ADMIN');
    const trialStudent = await user(2);
    const confirmedStudent = await user(3);
    const requiredStudent = await user(4);
    const cancelledStudent = await user(5);
    const failedStudent = await user(6);
    const outsider = await user(7);
    const mainCourse = await course('principal');
    const otherCourse = await course('autre');
    const session = await prisma.trainingSession.create({
      data: {
        name: 'Cohorte live', courseId: mainCourse.id,
        startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-03-31T23:59:00Z'),
        registrationDeadline: new Date('2026-12-20T00:00:00Z'), capacity: 20,
        weekDays: ['MONDAY', 'WEDNESDAY'], timezone: 'UTC', platform: 'Zoom', status: 'OPEN',
      },
    });
    const otherSession = await prisma.trainingSession.create({
      data: {
        name: 'Autre cohorte', courseId: otherCourse.id,
        startDate: new Date('2027-01-01T00:00:00Z'), endDate: new Date('2027-03-31T23:59:00Z'),
        registrationDeadline: new Date('2026-12-20T00:00:00Z'), capacity: 20,
        weekDays: ['MONDAY'], timezone: 'UTC', status: 'OPEN',
      },
    });
    const module = await prisma.courseModule.create({
      data: { courseId: mainCourse.id, title: 'Introductions professionnelles', position: 1, isPublished: true },
    });
    const lesson = await prisma.courseLesson.create({
      data: {
        courseModuleId: module.id, title: 'Introducing Yourself Professionally',
        description: 'Présenter son rôle et son expérience.', position: 1, isPublished: true,
      },
    });
    await prisma.lessonResource.create({
      data: { lessonId: lesson.id, title: 'Support du cours', type: 'PDF', url: 'https://example.com/support-live.pdf', position: 1 },
    });
    const disposableLesson = await prisma.courseLesson.create({
      data: { courseModuleId: module.id, title: 'Leçon supprimable', position: 2, isPublished: true },
    });
    const otherModule = await prisma.courseModule.create({
      data: { courseId: otherCourse.id, title: 'Module externe', position: 1, isPublished: true },
    });
    const otherLesson = await prisma.courseLesson.create({
      data: { courseModuleId: otherModule.id, title: 'Leçon externe', position: 1, isPublished: true },
    });
    const enrollments = {};
    for (const [name, account, status] of [
      ['trial', trialStudent, 'TRIAL_ACTIVE'], ['confirmed', confirmedStudent, 'CONFIRMED'],
      ['required', requiredStudent, 'PAYMENT_REQUIRED'], ['cancelled', cancelledStudent, 'CANCELLED'],
      ['failed', failedStudent, 'PAYMENT_FAILED'],
    ]) {
      enrollments[name] = await prisma.enrollment.create({
        data: { userId: account.id, trainingSessionId: session.id, status },
      });
    }
    await prisma.payment.create({
      data: {
        reference: `LIVE-PAID-${key}`, provider: 'TEST', amount: '100', baseAmount: '100',
        currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', paidAt: new Date(),
        enrollmentId: enrollments.confirmed.id, courseId: mainCourse.id,
      },
    });
    await prisma.payment.create({
      data: {
        reference: `LIVE-HALF-${key}`, provider: 'TEST', amount: '50', baseAmount: '100',
        currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', paidAt: new Date(),
        enrollmentId: enrollments.trial.id, courseId: mainCourse.id,
      },
    });

    const body = (overrides = {}) => ({
      trainingSessionId: String(session.id), lessonId: '', title: 'Cours live 1',
      date: '2027-01-04', startTime: '18:00', endTime: '20:00',
      platform: 'ZOOM', privateMeetingUrl: `https://zoom.example.test/private-${key}`,
      status: 'SCHEDULED', ...overrides,
    });
    let generalMeeting;
    let linkedMeeting;
    let preservedGeneralMeeting;

    await t.test('crée une séance générale et une séance liée à une leçon valide', async () => {
      generalMeeting = await classMeetingService.create(await classMeetingService.buildMeetingData(body()));
      assert.equal(generalMeeting.lessonId, null);
      assert.equal(generalMeeting.platform, 'ZOOM');
      linkedMeeting = await classMeetingService.create(await classMeetingService.buildMeetingData(body({
        date: '2027-01-06', lessonId: String(lesson.id), title: 'Introduction live', platform: 'GOOGLE_MEET',
        privateMeetingUrl: `https://meet.google.com/${key}`,
      })));
      assert.equal(linkedMeeting.lessonId, lesson.id);
      assert.equal(linkedMeeting.platform, 'GOOGLE_MEET');
    });

    await t.test('refuse une leçon d’une autre formation et modifie la leçon associée', async () => {
      await assert.rejects(
        classMeetingService.buildMeetingData(body({ date: '2027-01-11', lessonId: String(otherLesson.id) })),
        (error) => error.code === 'LESSON_COURSE_MISMATCH'
      );
      const loaded = await classMeetingService.findById(generalMeeting.id);
      const updated = await classMeetingService.update(
        generalMeeting.id,
        await classMeetingService.buildMeetingData(body({ lessonId: String(lesson.id) }), loaded)
      );
      assert.equal(updated.lessonId, lesson.id);
    });

    await t.test('conserve la séance lorsque sa leçon est supprimée', async () => {
      const temporary = await classMeetingService.create(await classMeetingService.buildMeetingData(body({
        date: '2027-01-13', lessonId: String(disposableLesson.id), title: 'Séance conservée',
        privateMeetingUrl: `https://teams.example.test/${key}`,
      })));
      await prisma.courseLesson.delete({ where: { id: disposableLesson.id } });
      const preserved = await prisma.classMeeting.findUnique({ where: { id: temporary.id } });
      assert.ok(preserved);
      assert.equal(preserved.lessonId, null);
      preservedGeneralMeeting = preserved;
    });

    await t.test('exige une plateforme contrôlée et une URL HTTPS', async () => {
      assert.equal(classMeetingService.validateMeetingUrl('https://example.com/live'), true);
      for (const url of ['http://example.com/live', 'javascript:alert(1)', 'data:text/plain,test', 'file:///secret']) {
        assert.equal(classMeetingService.validateMeetingUrl(url), false);
        await assert.rejects(
          classMeetingService.buildMeetingData(body({ date: '2027-01-18', privateMeetingUrl: url })),
          (error) => error.code === 'INVALID_URL'
        );
      }
      await assert.rejects(
        classMeetingService.buildMeetingData(body({ date: '2027-01-18', platform: 'SKYPE' })),
        (error) => error.code === 'INVALID_PLATFORM'
      );
    });

    const accessMeeting = await prisma.classMeeting.create({
      data: {
        trainingSessionId: session.id, lessonId: lesson.id, title: 'Cours accessible',
        startsAt: new Date(Date.now() + 10 * 60000), endsAt: new Date(Date.now() + 70 * 60000),
        platform: 'ZOOM', privateMeetingUrl: `https://zoom.example.test/access-${key}`, status: 'SCHEDULED',
      },
    });
    for (let index = 0; index < 5; index += 1) {
      const attendedMeeting = await prisma.classMeeting.create({
        data: {
          trainingSessionId: session.id,
          startsAt: new Date(Date.now() - (index + 3) * 86400000),
          endsAt: new Date(Date.now() - (index + 3) * 86400000 + 3600000),
          platform: 'OTHER', privateMeetingUrl: `https://example.com/trial-${index}-${key}`, status: 'COMPLETED',
        },
      });
      await prisma.attendance.create({
        data: { enrollmentId: enrollments.required.id, classMeetingId: attendedMeeting.id, status: 'PRESENT' },
      });
    }
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const cookies = {
      admin: await login(baseUrl, admin), trial: await login(baseUrl, trialStudent),
      confirmed: await login(baseUrl, confirmedStudent), required: await login(baseUrl, requiredStudent),
      cancelled: await login(baseUrl, cancelledStudent), failed: await login(baseUrl, failedStudent),
      outsider: await login(baseUrl, outsider),
    };

    await t.test('protège les pages administratives et étudiantes', async () => {
      assert.equal((await fetch(`${baseUrl}/admin/class-meetings/${linkedMeeting.id}`, { redirect: 'manual' })).status, 302);
      assert.equal((await fetch(`${baseUrl}/admin/class-meetings/${linkedMeeting.id}`, { headers: { Cookie: cookies.trial } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/student/class-meetings/${linkedMeeting.id}`, { redirect: 'manual' })).status, 302);
      assert.equal((await fetch(`${baseUrl}/student/class-meetings/${linkedMeeting.id}`, { headers: { Cookie: cookies.admin } })).status, 403);
      assert.equal((await fetch(`${baseUrl}/student/class-meetings/${linkedMeeting.id}`, { headers: { Cookie: cookies.outsider } })).status, 404);
    });

    await t.test('autorise le palier partiel confirmé après l’essai et isole', async () => {
      for (const name of ['trial', 'confirmed']) {
        const access = await trialAccessService.canAccessClassMeeting(
          name === 'trial' ? trialStudent.id : confirmedStudent.id,
          enrollments[name].id,
          accessMeeting.id
        );
        assert.equal(access.allowed, true);
      }
      for (const name of ['required', 'cancelled', 'failed']) {
        const account = { required: requiredStudent, cancelled: cancelledStudent, failed: failedStudent }[name];
        const access = await trialAccessService.canAccessClassMeeting(account.id, enrollments[name].id, accessMeeting.id);
        assert.equal(access.allowed, false);
        assert.equal(Object.hasOwn(access, 'meeting'), false);
      }
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(outsider.id, enrollments.trial.id, accessMeeting.id),
        (error) => error.code === 'ENROLLMENT_FORBIDDEN'
      );
    });

    await t.test('applique la fenêtre, les annulations et HTTPS au moment de rejoindre', async () => {
      const tooEarly = await prisma.classMeeting.create({
        data: {
          trainingSessionId: session.id, startsAt: new Date(Date.now() + 31 * 60000), endsAt: new Date(Date.now() + 90 * 60000),
          platform: 'OTHER', privateMeetingUrl: 'https://example.com/early', status: 'SCHEDULED',
        },
      });
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(trialStudent.id, enrollments.trial.id, tooEarly.id),
        (error) => error.code === 'MEETING_TOO_EARLY'
      );
      const ended = await prisma.classMeeting.create({
        data: {
          trainingSessionId: session.id, startsAt: new Date(Date.now() - 90 * 60000), endsAt: new Date(Date.now() - 1000),
          platform: 'OTHER', privateMeetingUrl: 'https://example.com/ended', status: 'SCHEDULED',
        },
      });
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(trialStudent.id, enrollments.trial.id, ended.id),
        (error) => error.code === 'MEETING_ENDED'
      );
      const cancelledMeeting = await prisma.classMeeting.create({
        data: {
          trainingSessionId: session.id, startsAt: new Date(Date.now() + 5 * 60000), endsAt: new Date(Date.now() + 60 * 60000),
          platform: 'ZOOM', privateMeetingUrl: 'https://example.com/cancelled', status: 'CANCELLED',
        },
      });
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(trialStudent.id, enrollments.trial.id, cancelledMeeting.id),
        (error) => error.code === 'MEETING_UNAVAILABLE'
      );
      const invalidStoredUrl = await prisma.classMeeting.create({
        data: {
          trainingSessionId: session.id, startsAt: new Date(Date.now() + 6 * 60000), endsAt: new Date(Date.now() + 60 * 60000),
          platform: 'OTHER', privateMeetingUrl: 'http://example.com/legacy', status: 'SCHEDULED',
        },
      });
      await assert.rejects(
        trialAccessService.canAccessClassMeeting(trialStudent.id, enrollments.trial.id, invalidStoredUrl.id),
        (error) => error.code === 'MEETING_URL_INVALID'
      );
    });

    await t.test('affiche le live, la leçon et les ressources sans exposer le lien privé', async () => {
      const detail = await fetch(`${baseUrl}/student/class-meetings/${accessMeeting.id}`, { headers: { Cookie: cookies.trial } });
      const html = await detail.text();
      assert.equal(detail.status, 200);
      assert.match(html, /Introducing Yourself Professionally|Présenter son rôle/);
      assert.match(html, /Support du cours|example\.com\/support-live\.pdf/);
      assert.match(html, new RegExp(`/class-meetings/${accessMeeting.id}/join\\?enrollment=${enrollments.trial.id}`));
      assert.doesNotMatch(html, /zoom\.example\.test\/access/);
      assert.doesNotMatch(html, /privateMeetingUrl|type="hidden"[^>]*meeting/i);

      const general = await fetch(`${baseUrl}/student/class-meetings/${preservedGeneralMeeting.id}`, { headers: { Cookie: cookies.trial } });
      assert.match(await general.text(), /Séance générale/);

      const join = await fetch(`${baseUrl}/class-meetings/${accessMeeting.id}/join?enrollment=${enrollments.trial.id}`, {
        headers: { Cookie: cookies.trial }, redirect: 'manual',
      });
      assert.equal(join.status, 302);
      assert.equal(join.headers.get('location'), `https://zoom.example.test/access-${key}`);
    });

    await t.test('affiche la relation live dans le programme', async () => {
      const page = await fetch(`${baseUrl}/student/courses/${enrollments.trial.id}/learn`, { headers: { Cookie: cookies.trial } });
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /Cours live|Introducing Yourself Professionally/);
      assert.doesNotMatch(html, /zoom\.example\.test/);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of courses) await prisma.course.delete({ where: { id } }).catch(() => {});
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
