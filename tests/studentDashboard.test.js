const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const attendanceService = require('../src/services/attendanceService');
const paymentService = require('../src/services/paymentService');

const shift = (minutes) => new Date(Date.now() + minutes * 60000);

test('espace étudiant', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const password = 'Etudiant@2026';
  const hash = await bcrypt.hash(password, 12);
  const suffix = String(Date.now()).slice(-7);
  let server;
  const users = [];
  const courses = [];

  async function user(index, role = 'STUDENT') {
    const created = await prisma.user.create({
      data: {
        firstName: index === 1 ? 'Aline' : `Compte${index}`,
        lastName: 'Test',
        phoneNumber: `+2438${index}${suffix}`,
        passwordHash: hash,
        role,
      },
    });
    users.push(created.id);
    return created;
  }

  async function enrollment(owner, label) {
    const course = await prisma.course.create({
      data: {
        title: `Formation ${label}`, slug: `student-${label}-${key}`, level: 'A2',
        duration: '8 semaines', price: '90', currency: 'USD', isPublished: true,
      },
    });
    courses.push(course.id);
    const session = await prisma.trainingSession.create({
      data: {
        name: `Session ${label}`, courseId: course.id, startDate: shift(-1440), endDate: shift(43200),
        registrationDeadline: shift(-2880), capacity: 20, weekDays: ['MONDAY'],
        startTime: '18:00', endTime: '20:00', platform: 'Google Meet', status: 'ONGOING',
      },
    });
    const created = await prisma.enrollment.create({
      data: { userId: owner.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' },
    });
    return { ...created, courseId: course.id };
  }

  async function login(baseUrl, account, pass = password) {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      body: new URLSearchParams({ phoneNumber: account.phoneNumber, password: pass }),
      redirect: 'manual',
    });
    return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  try {
    const student = await user(1);
    const other = await user(2);
    const admin = await user(3, 'ADMIN');
    const emptyStudent = await user(4);
    const own = await enrollment(student, 'principale');
    const foreign = await enrollment(other, 'privée');
    await prisma.assignment.create({
      data: {
        courseId: own.courseId,
        trainingSessionId: own.trainingSessionId,
        title: 'Devoir prioritaire',
        instructions: 'Répondez aux questions.',
        maxScore: 20,
        dueAt: shift(2880),
        isPublished: true,
      },
    });
    const openMeeting = await prisma.classMeeting.create({
      data: {
        title: 'Séance accessible', startsAt: shift(10), endsAt: shift(70),
        privateMeetingUrl: `https://meet.example.test/secret-${key}`, trainingSessionId: own.trainingSessionId,
      },
    });
    const futureMeeting = await prisma.classMeeting.create({
      data: {
        title: 'Séance future', startsAt: shift(300), endsAt: shift(360),
        privateMeetingUrl: `https://zoom.example.test/private-${key}`, trainingSessionId: own.trainingSessionId,
      },
    });
    await prisma.classMeeting.create({
      data: {
        title: 'Séance annulée', startsAt: shift(120), endsAt: shift(180),
        privateMeetingUrl: `https://private.example.test/cancelled-${key}`,
        trainingSessionId: own.trainingSessionId, status: 'CANCELLED',
      },
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const signedIn = await login(baseUrl, student);
    const cookie = signedIn.cookie;

    await t.test('redirige vers /student et protège toutes les pages', async () => {
      assert.equal(signedIn.response.headers.get('location'), '/student');
      const paths = ['/student', '/student/courses', `/student/courses/${own.id}`, '/student/schedule', '/student/payments', '/student/profile'];
      const adminCookie = (await login(baseUrl, admin)).cookie;
      for (const path of paths) {
        const anonymous = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
        assert.equal(anonymous.status, 302);
        assert.equal(anonymous.headers.get('location'), '/login');
        assert.equal((await fetch(`${baseUrl}${path}`, { headers: { Cookie: adminCookie } })).status, 403);
      }
    });

    await t.test('isole les données et ne divulgue aucun lien privé', async () => {
      const dashboard = await fetch(`${baseUrl}/student`, { headers: { Cookie: cookie } });
      const dashboardHtml = await dashboard.text();
      assert.match(dashboardHtml, /Bonjour Aline|Séance accessible/);
      assert.match(dashboardHtml, /Voici votre parcours aujourd’hui/);
      assert.match(dashboardHtml, /Prochaine séance|Ma progression/);
      assert.match(dashboardHtml, /0 séances sur 16|1 à remettre|À jour/);
      assert.equal((dashboardHtml.match(/class="student-header"/g) || []).length, 1);
      assert.match(dashboardHtml, /New Vision Academy — Tableau de bord étudiant/);
      assert.match(dashboardHtml, /Mes formations|Mon calendrier|Mes paiements|Mes devoirs|Mes certificats/);
      assert.match(dashboardHtml, /data-student-menu-toggle[^>]+aria-expanded="false"/);
      assert.match(dashboardHtml, /href="\/student" aria-current="page">Tableau de bord/);
      assert.doesNotMatch(dashboardHtml, /data-public-header|id="public-navigation"|nav-register/);
      assert.match(dashboardHtml, new RegExp(`/class-meetings/${openMeeting.id}/join\\?enrollment=${own.id}`));
      assert.doesNotMatch(dashboardHtml, /meet\.example\.test|zoom\.example\.test|Séance annulée/);

      const emptyCookie = (await login(baseUrl, emptyStudent)).cookie;
      const emptyDashboard = await fetch(`${baseUrl}/student`, { headers: { Cookie: emptyCookie } });
      const emptyHtml = await emptyDashboard.text();
      assert.equal(emptyDashboard.status, 200);
      assert.match(emptyHtml, /Aucune séance programmée/);
      assert.match(emptyHtml, /Aucune progression disponible pour le moment/);
      assert.match(emptyHtml, /Aucun devoir à remettre/);

      const listHtml = await (await fetch(`${baseUrl}/student/courses`, { headers: { Cookie: cookie } })).text();
      assert.match(listHtml, /Formation principale/);
      assert.doesNotMatch(listHtml, /Formation privée/);
      assert.equal(
        (await fetch(`${baseUrl}/student/courses/${foreign.id}`, { headers: { Cookie: cookie } })).status,
        404
      );
    });

    await t.test('calcule l’essai et la fenêtre d’accès côté serveur', async () => {
      const scheduleHtml = await (await fetch(`${baseUrl}/student/schedule?period=week`, { headers: { Cookie: cookie } })).text();
      assert.match(scheduleHtml, /Accès ouvert/);
      assert.doesNotMatch(scheduleHtml, new RegExp(`/class-meetings/${futureMeeting.id}/join`));
      assert.doesNotMatch(scheduleHtml, /Séance annulée|meet\.example\.test|zoom\.example\.test/);

      const presenceMeetings = [openMeeting];
      for (let index = 0; index < 5; index += 1) {
        presenceMeetings.push(await prisma.classMeeting.create({
          data: {
            title: `Présence ${index + 1}`, startsAt: shift(-500 - index * 100), endsAt: shift(-450 - index * 100),
            privateMeetingUrl: `https://private.example.test/${key}-${index}`,
            trainingSessionId: own.trainingSessionId, status: 'COMPLETED',
          },
        }));
      }
      for (const meeting of presenceMeetings) {
        await attendanceService.recordAttendance({ enrollmentId: own.id, classMeetingId: meeting.id, status: 'PRESENT' });
      }
      const detailHtml = await (await fetch(`${baseUrl}/student/courses/${own.id}`, { headers: { Cookie: cookie } })).text();
      assert.match(detailHtml, /période gratuite de 5 séances est terminée/i);
      assert.doesNotMatch(detailHtml, new RegExp(`/class-meetings/${openMeeting.id}/join`));
      assert.equal((await prisma.enrollment.findUnique({ where: { id: own.id } })).status, 'PAYMENT_REQUIRED');
    });

    await t.test('filtre les paiements, reprend une tentative et confirme l’accès', async () => {
      const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: own.id });
      const reused = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: own.id });
      assert.equal(reused.paymentReference, attempt.paymentReference);
      const html = await (await fetch(`${baseUrl}/student/payments`, { headers: { Cookie: cookie } })).text();
      assert.match(html, new RegExp(attempt.paymentReference));
      assert.match(html, /Reprendre/);
      assert.doesNotMatch(html, /metadata|providerReference|passwordHash|privateMeetingUrl/i);
      const dashboardWithRequiredPayment = await (await fetch(`${baseUrl}/student`, { headers: { Cookie: cookie } })).text();
      assert.match(dashboardWithRequiredPayment, /Paiement requis/);
      await paymentService.simulateSuccess(attempt.paymentReference, student.id);
      const confirmedHtml = await (await fetch(`${baseUrl}/student/courses/${own.id}`, { headers: { Cookie: cookie } })).text();
      assert.match(confirmedHtml, /Accès aux séances 6 à 10/);
    });

    await t.test('normalise le téléphone et contrôle son unicité', async () => {
      const newPhone = `+24389${suffix}`;
      const changed = await fetch(`${baseUrl}/student/profile`, {
        method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({
          firstName: 'Aline', lastName: 'Modifiée', phoneNumber: newPhone.replace('+243', '0'), currentPassword: password,
        }),
        redirect: 'manual',
      });
      assert.equal(changed.status, 302);
      assert.equal((await prisma.user.findUnique({ where: { id: student.id } })).phoneNumber, newPhone);
      const duplicate = await fetch(`${baseUrl}/student/profile`, {
        method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({
          firstName: 'Aline', lastName: 'Modifiée', phoneNumber: other.phoneNumber, currentPassword: password,
        }),
      });
      assert.equal(duplicate.status, 400);
      assert.match(await duplicate.text(), /déjà utilisé/);
    });

    await t.test('vérifie l’ancien mot de passe et ne divulgue pas le hash', async () => {
      const nextPassword = 'NouveauPass@2026';
      const denied = await fetch(`${baseUrl}/student/profile/password`, {
        method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({ currentPassword: 'incorrect', newPassword: nextPassword, confirmPassword: nextPassword }),
      });
      assert.equal(denied.status, 400);
      const changed = await fetch(`${baseUrl}/student/profile/password`, {
        method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({ currentPassword: password, newPassword: nextPassword, confirmPassword: nextPassword }),
        redirect: 'manual',
      });
      assert.equal(changed.status, 302);
      const saved = await prisma.user.findUnique({ where: { id: student.id } });
      assert.equal(await bcrypt.compare(nextPassword, saved.passwordHash), true);
      const html = await (await fetch(`${baseUrl}/student/profile`, { headers: { Cookie: cookie } })).text();
      assert.doesNotMatch(html, /passwordHash/);
      assert.doesNotMatch(html, new RegExp(saved.passwordHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of courses) await prisma.course.delete({ where: { id } }).catch(() => {});
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
