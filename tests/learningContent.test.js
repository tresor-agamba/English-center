const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const contentService = require('../src/services/learningContentService');
const accessService = require('../src/services/learningAccessService');

const addDays = (days) => new Date(Date.now() + days * 86400000);

test('gestion pédagogique des formations', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const password = 'Pedagogie@2026';
  const hash = await bcrypt.hash(password, 12);
  const suffix = String(Date.now()).slice(-7);
  const userIds = [];
  const courseIds = [];
  let server;

  async function createUser(index, role = 'STUDENT') {
    const item = await prisma.user.create({
      data: {
        firstName: `Pedago${index}`, lastName: 'Test', phoneNumber: `+2438${index}${suffix}`,
        passwordHash: hash, role,
      },
    });
    userIds.push(item.id);
    return item;
  }

  async function createCourse(label) {
    const course = await prisma.course.create({
      data: { title: `Cours ${label}`, slug: `pedago-${label}-${key}`, price: '50', isPublished: true },
    });
    courseIds.push(course.id);
    return course;
  }

  async function createEnrollment(userId, courseId, status) {
    const session = await prisma.trainingSession.create({
      data: {
        name: `Session ${courseId}-${userId}`, courseId, startDate: addDays(-2), endDate: addDays(30),
        registrationDeadline: addDays(-3), capacity: 20, status: 'ONGOING',
      },
    });
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
    const trialStudent = await createUser(2);
    const confirmedStudent = await createUser(3);
    const blockedStudent = await createUser(4);
    const otherStudent = await createUser(5);
    const course = await createCourse('principal');
    const otherCourse = await createCourse('autre');
    const trial = await createEnrollment(trialStudent.id, course.id, 'TRIAL_ACTIVE');
    const confirmed = await createEnrollment(confirmedStudent.id, course.id, 'CONFIRMED');
    const blocked = await createEnrollment(blockedStudent.id, course.id, 'PAYMENT_REQUIRED');
    const isolated = await createEnrollment(otherStudent.id, course.id, 'TRIAL_ACTIVE');
    const foreignEnrollment = await createEnrollment(trialStudent.id, otherCourse.id, 'TRIAL_ACTIVE');

    await t.test('valide, crée, modifie, publie et ordonne les modules', async () => {
      const first = await contentService.createModule(course.id, {
        title: 'Bases', description: 'Commencer ici', position: '1', isPublished: 'true',
      });
      const second = await contentService.createModule(course.id, {
        title: 'Conversation', position: '2', isPublished: 'true',
      });
      await assert.rejects(
        contentService.createModule(course.id, { title: 'Doublon', position: '2' }),
        (error) => error.code === 'POSITION_TAKEN'
      );
      const updated = await contentService.updateModule(first.id, {
        title: 'Bases anglaises', description: 'Description mise à jour', position: '1', isPublished: 'true',
      });
      assert.equal(updated.title, 'Bases anglaises');
      await contentService.moveModule(second.id, 'up');
      const ordered = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { position: 'asc' } });
      assert.equal(ordered[0].id, second.id);
      const toggled = await contentService.toggleModule(second.id);
      assert.equal(toggled.isPublished, false);
      await contentService.toggleModule(second.id);
    });

    const modules = await prisma.courseModule.findMany({ where: { courseId: course.id }, orderBy: { position: 'asc' } });
    const publishedModule = modules[0];
    const otherModule = modules[1];
    let firstLesson;
    let secondLesson;
    let hiddenLesson;
    let resource;

    await t.test('valide, crée, modifie, publie et ordonne les leçons', async () => {
      firstLesson = await contentService.createLesson(publishedModule.id, {
        title: 'Salutations', description: 'Premiers mots', content: '<script>secret()</script>\nHello!',
        estimatedMinutes: '20', position: '1', isPublished: 'true',
      });
      secondLesson = await contentService.createLesson(publishedModule.id, {
        title: 'Se présenter', content: 'Contenu deuxième leçon', estimatedMinutes: '30',
        position: '2', isPublished: 'true',
      });
      hiddenLesson = await contentService.createLesson(publishedModule.id, {
        title: 'Leçon secrète', content: 'SECRET_NON_PUBLIE', position: '3',
      });
      await assert.rejects(
        contentService.createLesson(publishedModule.id, { title: 'Position prise', position: '2' }),
        (error) => error.code === 'POSITION_TAKEN'
      );
      await assert.rejects(
        contentService.createLesson(publishedModule.id, { title: 'Durée invalide', position: '4', estimatedMinutes: '0' }),
        (error) => error.code === 'INVALID_DURATION'
      );
      const updated = await contentService.updateLesson(secondLesson.id, {
        title: 'Se présenter clairement', content: 'Nouveau contenu', estimatedMinutes: '35',
        position: '2', isPublished: 'true',
      });
      assert.equal(updated.estimatedMinutes, 35);
      await contentService.moveLesson(secondLesson.id, 'up');
      const ordered = await prisma.courseLesson.findMany({ where: { courseModuleId: publishedModule.id }, orderBy: { position: 'asc' } });
      assert.equal(ordered[0].id, secondLesson.id);
      const toggled = await contentService.toggleLesson(hiddenLesson.id);
      assert.equal(toggled.isPublished, true);
      await contentService.toggleLesson(hiddenLesson.id);
    });

    await t.test('valide, ajoute, modifie et ordonne les ressources', async () => {
      resource = await contentService.createResource(firstLesson.id, {
        title: 'Support PDF', type: 'PDF', url: 'https://drive.google.com/file/demo', position: '1',
      });
      const video = await contentService.createResource(firstLesson.id, {
        title: 'Vidéo', type: 'VIDEO_LINK', url: 'https://youtube.com/watch?v=demo', position: '2',
      });
      await assert.rejects(
        contentService.createResource(firstLesson.id, { title: 'Invalide', type: 'EXECUTABLE', url: 'https://example.com', position: '3' }),
        (error) => error.code === 'INVALID_RESOURCE_TYPE'
      );
      await assert.rejects(
        contentService.createResource(firstLesson.id, { title: 'Invalide', type: 'PDF', url: 'javascript:alert(1)', position: '3' }),
        (error) => error.code === 'INVALID_URL'
      );
      await assert.rejects(
        contentService.createResource(firstLesson.id, { title: 'Doublon', type: 'DOCUMENT', url: 'https://example.com/doc', position: '2' }),
        (error) => error.code === 'POSITION_TAKEN'
      );
      await contentService.moveResource(video.id, 'up');
      assert.equal((await prisma.lessonResource.findUnique({ where: { id: video.id } })).position, 1);
      const updated = await contentService.updateResource(resource.id, {
        title: 'Support actualisé', type: 'DOCUMENT', url: 'https://example.com/support', position: '2',
      });
      assert.equal(updated.type, 'DOCUMENT');
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const [adminCookie, trialCookie, confirmedCookie, blockedCookie, otherCookie] = await Promise.all([
      login(baseUrl, admin), login(baseUrl, trialStudent), login(baseUrl, confirmedStudent),
      login(baseUrl, blockedStudent), login(baseUrl, otherStudent),
    ]);

    await t.test('protège les routes administratives', async () => {
      const routes = [
        `/admin/courses/${course.id}/modules`, `/admin/courses/${course.id}/modules/new`,
        `/admin/modules/${publishedModule.id}/edit`, `/admin/modules/${publishedModule.id}/lessons/new`,
        `/admin/lessons/${firstLesson.id}/edit`, `/admin/lessons/${firstLesson.id}/resources`,
      ];
      for (const route of routes) {
        assert.equal((await fetch(`${baseUrl}${route}`, { redirect: 'manual' })).status, 302);
        assert.equal((await fetch(`${baseUrl}${route}`, { headers: { Cookie: trialCookie } })).status, 403);
        assert.equal((await fetch(`${baseUrl}${route}`, { headers: { Cookie: adminCookie } })).status, 200);
      }
    });

    await t.test('autorise TRIAL_ACTIVE et CONFIRMED, échappe le contenu et masque les brouillons', async () => {
      for (const [enrollment, cookie] of [[trial, trialCookie], [confirmed, confirmedCookie]]) {
        const learn = await fetch(`${baseUrl}/student/courses/${enrollment.id}/learn`, { headers: { Cookie: cookie } });
        const learnHtml = await learn.text();
        assert.equal(learn.status, 200);
        assert.doesNotMatch(learnHtml, /Leçon secrète|SECRET_NON_PUBLIE/);
        const detail = await fetch(`${baseUrl}/student/courses/${enrollment.id}/lessons/${firstLesson.id}`, { headers: { Cookie: cookie } });
        const detailHtml = await detail.text();
        assert.equal(detail.status, 200);
        assert.match(detailHtml, /Support actualisé/);
        assert.match(detailHtml, /&lt;script&gt;secret\(\)&lt;\/script&gt;/);
        assert.doesNotMatch(detailHtml, /<script>secret\(\)<\/script>/);
      }
    });

    await t.test('montre seulement le sommaire à PAYMENT_REQUIRED sans contenu ni ressource', async () => {
      const outline = await fetch(`${baseUrl}/student/courses/${blocked.id}/learn`, { headers: { Cookie: blockedCookie } });
      const html = await outline.text();
      assert.equal(outline.status, 200);
      assert.match(html, /Paiement|sommaire|bloqué/i);
      assert.match(html, /Salutations/);
      assert.doesNotMatch(html, /Hello!|Support actualisé|example\.com\/support|drive\.google/);
      const detail = await fetch(`${baseUrl}/student/courses/${blocked.id}/lessons/${firstLesson.id}`, { headers: { Cookie: blockedCookie } });
      const detailHtml = await detail.text();
      assert.equal(detail.status, 403);
      assert.doesNotMatch(detailHtml, /Hello!|Support actualisé|example\.com\/support/);
    });

    await t.test('refuse une leçon d’une autre formation et isole les étudiants', async () => {
      const foreignModule = await contentService.createModule(otherCourse.id, {
        title: 'Module étranger', position: '1', isPublished: 'true',
      });
      const foreignLesson = await contentService.createLesson(foreignModule.id, {
        title: 'Leçon étrangère', content: 'CONTENU_ETRANGER', position: '1', isPublished: 'true',
      });
      assert.equal(
        (await fetch(`${baseUrl}/student/courses/${trial.id}/lessons/${foreignLesson.id}`, { headers: { Cookie: trialCookie } })).status,
        404
      );
      assert.equal(
        (await fetch(`${baseUrl}/student/courses/${trial.id}/learn`, { headers: { Cookie: otherCookie } })).status,
        404
      );
      assert.equal(
        (await fetch(`${baseUrl}/student/courses/${foreignEnrollment.id}/lessons/${firstLesson.id}`, { headers: { Cookie: trialCookie } })).status,
        404
      );
    });

    await t.test('calcule la progression, la prochaine leçon et reste idempotent', async () => {
      let summary = await accessService.getLearningPath(trialStudent.id, trial.id);
      assert.equal(summary.progress.totalPublishedLessons, 2);
      assert.equal(summary.progress.completedLessons, 0);
      assert.equal(summary.progress.nextLesson.id, secondLesson.id);
      await accessService.setCompleted(trialStudent.id, trial.id, secondLesson.id, true);
      await accessService.setCompleted(trialStudent.id, trial.id, secondLesson.id, true);
      assert.equal(await prisma.lessonProgress.count({ where: { enrollmentId: trial.id, lessonId: secondLesson.id } }), 1);
      summary = await accessService.getLearningPath(trialStudent.id, trial.id);
      assert.equal(summary.progress.completedLessons, 1);
      assert.equal(summary.progress.remainingLessons, 1);
      assert.equal(summary.progress.progressPercentage, 50);
      assert.equal(summary.progress.nextLesson.id, firstLesson.id);
      assert.equal((await accessService.getLearningPath(otherStudent.id, isolated.id)).progress.completedLessons, 0);
      await accessService.setCompleted(trialStudent.id, trial.id, secondLesson.id, false);
      summary = await accessService.getLearningPath(trialStudent.id, trial.id);
      assert.equal(summary.progress.completedLessons, 0);
      assert.equal(summary.progress.progressPercentage, 0);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of courseIds) await prisma.course.delete({ where: { id } }).catch(() => {});
    for (const id of userIds) await prisma.user.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
