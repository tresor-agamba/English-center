const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const publicCourseService = require('../src/services/publicCourseService');
const publicCourseController = require('../src/controllers/publicCourseController');

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
        courses: [],
      });
      assert.match(html, /Aucune formation disponible/);
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
          startDate: addDays(now, 10),
          endDate: addDays(now, 20),
          registrationDeadline: addDays(now, 8),
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
      const courses = await publicCourseService.listPublished();
      const published = courses.find((course) => course.id === publishedCourseId);
      assert.ok(published);
      assert.equal(published.upcomingSessionCount, 1);
      assert.equal(courses.some((course) => course.id === hiddenCourseId), false);
    });

    await t.test('exclut les sessions passées et annulées et calcule les places restantes', async () => {
      const courseRow = await prisma.course.findUnique({ where: { id: publishedCourseId } });
      const course = await publicCourseService.findPublishedBySlug(courseRow.slug);
      assert.deepEqual(
        course.trainingSessions.map((session) => session.name),
        ['Session future ouverte', 'Session future complète']
      );
      const openSession = course.trainingSessions[0];
      assert.equal(openSession.remainingPlaces, 2);
      assert.equal(openSession.registrationOpen, true);
      assert.equal(Object.hasOwn(openSession, '_count'), false);
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
