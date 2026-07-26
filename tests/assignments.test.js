const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const assignmentService = require('../src/services/assignmentService');
const assignmentAccess = require('../src/services/assignmentAccessService');

const shiftMinutes = (minutes) => new Date(Date.now() + minutes * 60000);

test('devoirs, soumissions, corrections et notes', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const suffix = String(Date.now()).slice(-7);
  const password = 'Devoirs@2026';
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [];
  const courses = [];
  let server;

  async function createUser(index, role = 'STUDENT') {
    const user = await prisma.user.create({
      data: {
        firstName: `Devoir${index}`, lastName: 'Test', phoneNumber: `+2438${index}${suffix}`,
        passwordHash, role,
      },
    });
    users.push(user.id);
    return user;
  }

  async function createCourse(label) {
    const course = await prisma.course.create({
      data: { title: `Cours ${label}`, slug: `assignments-${label}-${key}`, price: '100', isPublished: true },
    });
    courses.push(course.id);
    return course;
  }

  async function enroll(userId, courseId, status) {
    let session = await prisma.trainingSession.findFirst({ where: { courseId } });
    if (!session) {
      session = await prisma.trainingSession.create({
        data: {
          name: `Session ${courseId}`, courseId, startDate: shiftMinutes(-1440), endDate: shiftMinutes(43200),
          registrationDeadline: shiftMinutes(-2880), capacity: 30, status: 'ONGOING',
        },
      });
    }
    return prisma.enrollment.create({ data: { userId, trainingSessionId: session.id, status } });
  }

  async function login(baseUrl, user) {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST', body: new URLSearchParams({ phoneNumber: user.phoneNumber, password }), redirect: 'manual',
    });
    return response.headers.get('set-cookie')?.split(';')[0];
  }

  try {
    const admin = await createUser(1, 'ADMIN');
    const trialUser = await createUser(2);
    const confirmedUser = await createUser(3);
    const paymentUser = await createUser(4);
    const cancelledUser = await createUser(5);
    const failedUser = await createUser(6);
    const course = await createCourse('principal');
    const foreignCourse = await createCourse('étranger');
    const trial = await enroll(trialUser.id, course.id, 'TRIAL_ACTIVE');
    const confirmed = await enroll(confirmedUser.id, course.id, 'CONFIRMED');
    const paymentRequired = await enroll(paymentUser.id, course.id, 'PAYMENT_REQUIRED');
    const cancelled = await enroll(cancelledUser.id, course.id, 'CANCELLED');
    const paymentFailed = await enroll(failedUser.id, course.id, 'PAYMENT_FAILED');
    const module = await prisma.courseModule.create({
      data: { courseId: course.id, title: 'Module principal', position: 1, isPublished: true },
    });
    const lesson = await prisma.lesson.create({
      data: { courseModuleId: module.id, title: 'Leçon principale', position: 1, isPublished: true },
    });
    const foreignModule = await prisma.courseModule.create({
      data: { courseId: foreignCourse.id, title: 'Module étranger', position: 1, isPublished: true },
    });
    const foreignLesson = await prisma.lesson.create({
      data: { courseModuleId: foreignModule.id, title: 'Leçon étrangère', position: 1, isPublished: true },
    });
    let assignment;

    await t.test('crée, modifie et valide les rattachements, note et date', async () => {
      assignment = await assignmentService.createAssignment(course.id, {
        title: 'Expression écrite', instructions: '<script>instruction()</script>\nRédigez un texte.',
        maxScore: '20.00', dueAt: shiftMinutes(120).toISOString(),
        lessonId: String(lesson.id), isPublished: 'true',
      });
      assert.equal(assignment.courseModuleId, module.id);
      assert.equal(assignment.lessonId, lesson.id);
      assignment = await assignmentService.updateAssignment(assignment.id, {
        title: 'Expression écrite finale', instructions: 'Rédigez un texte complet.',
        maxScore: '25.50', dueAt: shiftMinutes(180).toISOString(),
        courseModuleId: String(module.id), lessonId: String(lesson.id), isPublished: 'true',
      });
      assert.equal(assignment.title, 'Expression écrite finale');
      assert.equal(String(assignment.maxScore), '25.5');
      await assert.rejects(
        assignmentService.createAssignment(course.id, {
          title: 'Mauvais module', instructions: 'Consignes', maxScore: '10', courseModuleId: String(foreignModule.id),
        }),
        (error) => error.code === 'MODULE_COURSE_MISMATCH'
      );
      await assert.rejects(
        assignmentService.createAssignment(course.id, {
          title: 'Mauvaise leçon', instructions: 'Consignes', maxScore: '10', lessonId: String(foreignLesson.id),
        }),
        (error) => error.code === 'LESSON_COURSE_MISMATCH'
      );
      for (const maxScore of ['0', '-1', 'abc']) {
        await assert.rejects(
          assignmentService.createAssignment(course.id, { title: 'Note invalide', instructions: 'Consignes', maxScore }),
          (error) => error.code === 'INVALID_DECIMAL'
        );
      }
      await assert.rejects(
        assignmentService.createAssignment(course.id, { title: 'Date invalide', instructions: 'Consignes', maxScore: '10', dueAt: 'pas-une-date' }),
        (error) => error.code === 'INVALID_DUE_DATE'
      );
    });

    await t.test('publie, masque et protège la suppression avec soumissions', async () => {
      const toggled = await assignmentService.togglePublished(assignment.id);
      assert.equal(toggled.isPublished, false);
      await assignmentService.togglePublished(assignment.id);
      const disposable = await assignmentService.createAssignment(course.id, {
        title: 'Temporaire', instructions: 'À supprimer', maxScore: '5',
      });
      assert.equal((await assignmentService.deleteAssignment(disposable.id)).deleted, true);
      assert.equal(await prisma.assignment.findUnique({ where: { id: disposable.id } }), null);
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const [adminCookie, trialCookie, confirmedCookie, paymentCookie, cancelledCookie, failedCookie] = await Promise.all([
      login(baseUrl, admin), login(baseUrl, trialUser), login(baseUrl, confirmedUser),
      login(baseUrl, paymentUser), login(baseUrl, cancelledUser), login(baseUrl, failedUser),
    ]);

    await t.test('protège les routes administratives et étudiantes', async () => {
      const adminRoutes = [
        `/admin/courses/${course.id}/assignments`, `/admin/courses/${course.id}/assignments/new`,
        `/admin/assignments/${assignment.id}`, `/admin/assignments/${assignment.id}/edit`,
        `/admin/assignments/${assignment.id}/submissions`,
      ];
      for (const route of adminRoutes) {
        assert.equal((await fetch(`${baseUrl}${route}`, { redirect: 'manual' })).status, 302);
        assert.equal((await fetch(`${baseUrl}${route}`, { headers: { Cookie: trialCookie } })).status, 403);
        assert.equal((await fetch(`${baseUrl}${route}`, { headers: { Cookie: adminCookie } })).status, 200);
      }
      assert.equal((await fetch(`${baseUrl}/student/assignments`, { redirect: 'manual' })).status, 302);
      assert.equal((await fetch(`${baseUrl}/student/assignments`, { headers: { Cookie: adminCookie } })).status, 403);
    });

    await t.test('autorise TRIAL_ACTIVE et CONFIRMED, refuse les autres statuts et les brouillons', async () => {
      for (const [enrollment, cookie] of [[trial, trialCookie], [confirmed, confirmedCookie]]) {
        const response = await fetch(`${baseUrl}/student/courses/${enrollment.id}/assignments/${assignment.id}`, { headers: { Cookie: cookie } });
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /Rédigez un texte complet/);
      }
      for (const [enrollment, cookie] of [[paymentRequired, paymentCookie], [cancelled, cancelledCookie], [paymentFailed, failedCookie]]) {
        const response = await fetch(`${baseUrl}/student/courses/${enrollment.id}/assignments/${assignment.id}`, { headers: { Cookie: cookie } });
        assert.equal(response.status, 403);
        assert.doesNotMatch(await response.text(), /Rédigez un texte complet/);
      }
      const globalCancelled = await (await fetch(`${baseUrl}/student/assignments`, { headers: { Cookie: cancelledCookie } })).text();
      const globalFailed = await (await fetch(`${baseUrl}/student/assignments`, { headers: { Cookie: failedCookie } })).text();
      assert.doesNotMatch(globalCancelled, /Expression écrite finale/);
      assert.doesNotMatch(globalFailed, /Expression écrite finale/);
      const draft = await assignmentService.createAssignment(course.id, {
        title: 'BROUILLON_SECRET', instructions: 'INSTRUCTIONS_SECRETES', maxScore: '10',
      });
      const response = await fetch(`${baseUrl}/student/courses/${trial.id}/assignments/${draft.id}`, { headers: { Cookie: trialCookie } });
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), /INSTRUCTIONS_SECRETES/);
    });

    let submission;
    await t.test('accepte texte ou URL, refuse vide et URL invalide, et isole les inscriptions', async () => {
      submission = await assignmentAccess.submit(trialUser.id, trial.id, assignment.id, { answerText: '<b>Ma réponse</b>' });
      assert.equal(submission.status, 'SUBMITTED');
      assert.ok(submission.submittedAt);
      submission = await assignmentAccess.submit(trialUser.id, trial.id, assignment.id, { answerUrl: 'https://example.com/travail' });
      assert.equal(submission.answerText, null);
      assert.equal(submission.answerUrl, 'https://example.com/travail');
      assert.equal(await prisma.assignmentSubmission.count({ where: { assignmentId: assignment.id, enrollmentId: trial.id } }), 1);
      await assert.rejects(
        assignmentAccess.submit(confirmedUser.id, confirmed.id, assignment.id, {}),
        (error) => error.code === 'EMPTY_SUBMISSION'
      );
      await assert.rejects(
        assignmentAccess.submit(confirmedUser.id, confirmed.id, assignment.id, { answerUrl: 'javascript:alert(1)' }),
        (error) => error.code === 'INVALID_URL'
      );
      await assert.rejects(
        assignmentAccess.submit(confirmedUser.id, trial.id, assignment.id, { answerText: 'Fraude' }),
        (error) => error.code === 'ENROLLMENT_NOT_FOUND'
      );
      const otherHtml = await (await fetch(`${baseUrl}/student/courses/${confirmed.id}/assignments/${assignment.id}`, { headers: { Cookie: confirmedCookie } })).text();
      assert.doesNotMatch(otherHtml, /example\.com\/travail|Ma réponse/);
    });

    await t.test('applique les règles de date limite et de retard', async () => {
      const lateAllowed = await assignmentService.createAssignment(course.id, {
        title: 'Retard autorisé', instructions: 'Travail tardif', maxScore: '10',
        dueAt: shiftMinutes(-10).toISOString(), allowLateSubmission: 'true', isPublished: 'true',
      });
      const late = await assignmentAccess.submit(confirmedUser.id, confirmed.id, lateAllowed.id, { answerText: 'En retard' });
      assert.equal(late.status, 'LATE');
      const lateDenied = await assignmentService.createAssignment(course.id, {
        title: 'Retard refusé', instructions: 'Travail fermé', maxScore: '10',
        dueAt: shiftMinutes(-10).toISOString(), isPublished: 'true',
      });
      await assert.rejects(
        assignmentAccess.submit(confirmedUser.id, confirmed.id, lateDenied.id, { answerText: 'Trop tard' }),
        (error) => ['SUBMISSION_LOCKED', 'DEADLINE_PASSED'].includes(error.code)
      );
    });

    await t.test('corrige avec Decimal et refuse les notes hors limites', async () => {
      await assert.rejects(
        assignmentService.gradeSubmission(assignment.id, submission.id, { score: '-1', feedback: 'Impossible' }),
        (error) => ['INVALID_DECIMAL', 'INVALID_SCORE'].includes(error.code)
      );
      await assert.rejects(
        assignmentService.gradeSubmission(assignment.id, submission.id, { score: '25.51', feedback: 'Trop élevé' }),
        (error) => error.code === 'INVALID_SCORE'
      );
      submission = await assignmentService.gradeSubmission(assignment.id, submission.id, {
        score: '20.25', feedback: 'FEEDBACK_PRIVE',
      });
      assert.equal(submission.status, 'GRADED');
      assert.ok(submission.gradedAt);
    });

    await t.test('ne publie ni note ni feedback avant publication', async () => {
      const response = await fetch(`${baseUrl}/student/courses/${trial.id}/assignments/${assignment.id}`, { headers: { Cookie: trialCookie } });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.doesNotMatch(html, /20\.25|FEEDBACK_PRIVE/);
      assert.match(html, /example\.com\/travail/);
    });

    await t.test('une modification avant publication invalide la correction', async () => {
      submission = await assignmentAccess.submit(trialUser.id, trial.id, assignment.id, { answerText: 'Réponse corrigée' });
      assert.equal(submission.status, 'SUBMITTED');
      assert.equal(submission.score, null);
      assert.equal(submission.feedback, null);
      assert.equal(submission.gradedAt, null);
    });

    await t.test('publie puis annule la publication de la correction', async () => {
      await assignmentService.gradeSubmission(assignment.id, submission.id, { score: '21.50', feedback: 'Très bon travail' });
      let returned = await assignmentService.setFeedbackPublished(assignment.id, submission.id, true);
      assert.equal(returned.status, 'RETURNED');
      let html = await (await fetch(`${baseUrl}/student/courses/${trial.id}/assignments/${assignment.id}`, { headers: { Cookie: trialCookie } })).text();
      assert.match(html, /21\.5|Très bon travail/);
      returned = await assignmentService.setFeedbackPublished(assignment.id, submission.id, false);
      assert.equal(returned.status, 'GRADED');
      html = await (await fetch(`${baseUrl}/student/courses/${trial.id}/assignments/${assignment.id}`, { headers: { Cookie: trialCookie } })).text();
      assert.doesNotMatch(html, /21\.5|Très bon travail/);
    });

    await t.test('calcule les statistiques et affiche les étudiants sans soumission', async () => {
      await assignmentService.setFeedbackPublished(assignment.id, submission.id, true);
      const data = await assignmentService.submissionRows(assignment.id);
      const stats = assignmentService.calculateStatistics(data.rows, assignment.maxScore);
      assert.equal(stats.eligibleStudents, 2);
      assert.equal(stats.submittedCount, 1);
      assert.equal(stats.missingCount, 1);
      assert.equal(stats.returnedCount, 1);
      assert.equal(Number(stats.averageScore), 21.5);
      assert.ok(Math.abs(Number(stats.averagePercentage) - 84.31372549) < 0.0001);
      const page = await fetch(`${baseUrl}/admin/assignments/${assignment.id}/submissions`, { headers: { Cookie: adminCookie } });
      const html = await page.text();
      assert.match(html, /Aucune soumission/);
      assert.match(html, new RegExp(confirmedUser.phoneNumber.replace('+', '\\+')));
      const deletion = await assignmentService.deleteAssignment(assignment.id);
      assert.equal(deletion.hidden, true);
      assert.equal((await prisma.assignment.findUnique({ where: { id: assignment.id } })).isPublished, false);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of courses) await prisma.course.delete({ where: { id } }).catch(() => {});
    for (const id of users) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
