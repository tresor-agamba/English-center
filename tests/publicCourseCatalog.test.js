const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const publicCourseService = require('../src/services/publicCourseService');
const publicCourseController = require('../src/controllers/publicCourseController');
const { formatCourseType, formatDuration } = require('../src/utils/catalogFormat.util');
const { buildPublicCourseCard } = require('../src/utils/publicCoursePresentation.util');

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function renderFile(file, data) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.resolve(file), data, (error, html) => (error ? reject(error) : resolve(html)));
  });
}

test('catalogue public des formations', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const now = new Date();
  let publishedCourseId;
  let hiddenCourseId;
  let studentId;

  try {
    await t.test('rend clairement un catalogue vide', async () => {
      const html = await renderFile('views/public/courses/index.ejs', {
        title: 'Nos formations',
        courses: [], courseCards: [], categories: [],
      });
      assert.match(html, /Aucune formation n'est actuellement disponible/);
    });

    await t.test('prépare formations et sessions de contrôle', async () => {
      const published = await prisma.course.create({
        data: {
          title: 'Formation publique test',
          slug: `formation-publique-${unique}`,
          description: 'Description complète',
          shortDescription: 'Description courte',
          level: 'Intermédiaire',
          duration: '8 semaines',
          objectives: 'Communiquer avec aisance',
          targetAudience: 'Adultes',
          prerequisites: 'Niveau débutant',
          price: '125.00',
          currency: 'USD',
          trainingMode: 'Présentiel',
          isPublished: true,
          lmsStatus: 'PUBLISHED',
          publishedAt: now,
          durationValue: 8,
          durationUnit: 'WEEKS',
          pricingMode: 'ONE_TIME',
          pricingActive: true,
        },
      });
      publishedCourseId = published.id;

      const hidden = await prisma.course.create({
        data: {
          title: 'Formation privée test',
          slug: `formation-privee-${unique}`,
          isPublished: false,
        },
      });
      hiddenCourseId = hidden.id;

      const passwordHash = await bcrypt.hash('Catalogue@2026', 12);
      const student = await prisma.user.create({
        data: {
          firstName: 'Catalogue',
          lastName: 'Test',
          phoneNumber: `+24389${String(Date.now()).slice(-7)}`,
          passwordHash,
          role: 'STUDENT',
        },
      });
      studentId = student.id;

      const futureOpen = await prisma.trainingSession.create({
        data: {
          name: 'Session future ouverte',
          courseId: published.id,
          startDate: addDays(now, 0.01),
          endDate: addDays(now, 20),
          registrationDeadline: addDays(now, 0.005),
          capacity: 3,
          status: 'OPEN',
        },
      });
      await prisma.enrollment.create({
        data: { userId: student.id, trainingSessionId: futureOpen.id },
      });

      await prisma.trainingSession.createMany({
        data: [
          {
            name: 'Session passée',
            courseId: published.id,
            startDate: addDays(now, -20),
            endDate: addDays(now, -10),
            registrationDeadline: addDays(now, -22),
            capacity: 10,
            status: 'OPEN',
          },
          {
            name: 'Session annulée',
            courseId: published.id,
            startDate: addDays(now, 15),
            endDate: addDays(now, 25),
            registrationDeadline: addDays(now, 12),
            capacity: 10,
            status: 'CANCELLED',
          },
          {
            name: 'Session future complète',
            courseId: published.id,
            startDate: addDays(now, 30),
            endDate: addDays(now, 40),
            registrationDeadline: addDays(now, 28),
            capacity: 0,
            status: 'FULL',
          },
        ],
      });
    });

    await t.test('liste uniquement les formations publiées et compte les sessions ouvertes', async () => {
      const countBefore = await prisma.course.count();
      const courses = await publicCourseService.listPublished();
      const published = courses.find((course) => course.id === publishedCourseId);
      assert.ok(published);
      assert.equal(published.upcomingSessionCount, 1);
      assert.equal(courses.some((course) => course.id === hiddenCourseId), false);
      assert.equal(new Set(courses.map((course) => course.id)).size, courses.length);
      assert.equal(await prisma.course.count(), countBefore, 'la consultation ne supprime aucune donnée, même de test');
      assert.ok(published.nextSessionStart instanceof Date);
    });

    await t.test('exclut les sessions passées et annulées et calcule les places restantes', async () => {
      const courseRow = await prisma.course.findUnique({ where: { id: publishedCourseId } });
      const course = await publicCourseService.findPublishedBySlug(courseRow.slug);
      assert.deepEqual(
        course.trainingSessions.map((session) => session.name),
        ['Session future ouverte']
      );
      const openSession = course.trainingSessions[0];
      assert.equal(openSession.remainingPlaces, 2);
      assert.equal(openSession.registrationOpen, true);
      assert.equal(Object.hasOwn(openSession, '_count'), false);
    });

    await t.test('publie les prochaines sessions ouvertes dans l’ordre sans données expirées', async () => {
      const sessions = await publicCourseService.listUpcomingSessions(6);
      const controlled = sessions.filter((session) => session.course.title === 'Formation publique test');
      assert.deepEqual(controlled.map((session) => session.name), ['Session future ouverte']);
      assert.equal(controlled[0].remainingPlaces, 2);
      assert.ok(controlled.every((session) => session.startDate >= now));
      assert.ok(controlled.every((session, index) => index === 0 || controlled[index - 1].startDate <= session.startDate));
      assert.equal(new Set(sessions.map((session) => session.id)).size, sessions.length);
      assert.ok(controlled.every((session) => session.courseId === publishedCourseId));
    });

    await t.test('utilise des fallbacks neutres traduisibles sans inventer de catégorie ni durée', async () => {
      assert.equal(formatCourseType('OTHER'), null);
      assert.equal(formatDuration({}), null);
      const html = await renderFile('views/public/courses/index.ejs', {
        title: 'Nos formations',
        courses: [{
          id: 999999, slug: 'fallback-test', title: 'Formation sans métadonnées',
          courseType: 'OTHER', level: null, duration: null, durationValue: null,
          durationUnit: null, shortDescription: null, description: null, price: null,
          currency: 'USD', upcomingSessionCount: 0, nextSessionStart: null,
        }],
        courseCards: [buildPublicCourseCard({
          id: 999999, slug: 'fallback-test', title: 'Formation sans métadonnées', courseType: 'OTHER',
          durationValue: null, durationUnit: null, price: null, pricingActive: false,
          upcomingSessionCount: 0, nextPlannedSessionStart: null,
        })], categories: [], formatCourseType,
        formatDuration,
      });
      assert.match(html, /data-i18n="fallback\.category"/);
      assert.match(html, /data-i18n="course\.fact\.duration"/);
      assert.doesNotMatch(html, /Autre formation/);
    });

    await t.test('renvoie une page 404 claire pour un slug inexistant', async () => {
      const response = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        render(view, data) { this.view = view; this.data = data; return this; },
      };
      await publicCourseController.show({ params: { slug: `absente-${unique}` } }, response);
      assert.equal(response.statusCode, 404);
      assert.equal(response.view, 'error');
      assert.match(response.data.message, /introuvable/i);
    });

    await t.test('autorise l’accès HTTP sans session', async () => {
      const server = app.listen(0);
      try {
        await new Promise((resolve) => server.once('listening', resolve));
        const port = server.address().port;
        const listResponse = await fetch(`http://127.0.0.1:${port}/formations`);
        assert.equal(listResponse.status, 200);
        assert.match(await listResponse.text(), /Formation publique test/);

        const courseRow = await prisma.course.findUnique({ where: { id: publishedCourseId } });
        const detailResponse = await fetch(`http://127.0.0.1:${port}/formations/${courseRow.slug}`);
        assert.equal(detailResponse.status, 200);
        assert.match(await detailResponse.text(), /Session future ouverte/);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  } finally {
    if (publishedCourseId) await prisma.course.delete({ where: { id: publishedCourseId } }).catch(() => {});
    if (hiddenCourseId) await prisma.course.delete({ where: { id: hiddenCourseId } }).catch(() => {});
    if (studentId) await prisma.user.delete({ where: { id: studentId } }).catch(() => {});
    await prisma.$disconnect();
  }
});
