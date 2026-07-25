const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');
const courseService = require('../src/services/courseService');
const sessionService = require('../src/services/trainingSessionService');
const courseController = require('../src/controllers/adminCourseController');
const sessionController = require('../src/controllers/adminSessionController');

test('configuration administrative du catalogue', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const createdCourseIds = [];
  let course;
  let openSession;
  let privateUrl;
  let studentId;
  let server;
  let baseUrl;

  const courseBody = {
    title: `Business English Banque ${unique}`,
    courseType: 'ENGLISH_FOR_BANKERS',
    level: 'Intermédiaire',
    durationValue: '8',
    durationUnit: 'WEEKS',
    price: '150.50',
    currency: 'USD',
    shortDescription: 'Anglais professionnel pour le secteur bancaire.',
    description: 'Une formation complète destinée aux professionnels.',
    objectives: 'Présenter et négocier en anglais.',
    targetAudience: 'Professionnels de banque.',
    prerequisites: 'Niveau élémentaire.',
    isPublished: 'on',
  };

  function validSessionBody(overrides = {}) {
    return {
      name: 'Session du soir',
      courseId: String(course.id),
      startDate: '2027-01-10',
      endDate: '2027-03-10',
      weekDays: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
      startTime: '18:00',
      endTime: '20:00',
      timezone: 'Africa/Kinshasa',
      platform: 'Zoom',
      registrationDeadline: '2027-01-08T18:00',
      capacity: '20',
      status: 'OPEN',
      ...overrides,
    };
  }

  try {
    await t.test('crée une formation structurée et génère un slug unique', async () => {
      const data = courseController.parseForm(courseBody);
      const slug = await courseController.uniqueSlug(data.title);
      course = await courseService.create({ ...data, slug });
      createdCourseIds.push(course.id);
      assert.equal(course.courseType, 'ENGLISH_FOR_BANKERS');
      assert.equal(course.durationValue, 8);
      assert.equal(course.durationUnit, 'WEEKS');
      assert.equal(Number(course.price), 150.5);
      assert.equal(course.currency, 'USD');
      assert.equal(course.trainingMode, '100 % en ligne');
      assert.equal(course.isPublished, true);

      const duplicateData = courseController.parseForm({ ...courseBody, isPublished: undefined });
      const duplicateSlug = await courseController.uniqueSlug(duplicateData.title);
      const duplicate = await courseService.create({ ...duplicateData, slug: duplicateSlug });
      createdCourseIds.push(duplicate.id);
      assert.notEqual(duplicate.slug, course.slug);
      assert.match(duplicate.slug, /-2$/);
    });

    await t.test('rejette prix négatif et devise non autorisée', () => {
      assert.throws(() => courseController.parseForm({ ...courseBody, price: '-1' }), /prix/i);
      assert.throws(() => courseController.parseForm({ ...courseBody, currency: 'EUR' }), /devise/i);
    });

    await t.test('crée une session avec jours et horaires contrôlés', async () => {
      const data = sessionController.parseForm(validSessionBody());
      openSession = await sessionService.create(data);
      assert.deepEqual(openSession.weekDays, ['MONDAY', 'WEDNESDAY', 'FRIDAY']);
      assert.equal(openSession.startTime, '18:00');
      assert.equal(openSession.endTime, '20:00');
      assert.equal(openSession.timezone, 'Africa/Kinshasa');
      assert.equal(openSession.platform, 'Zoom');
    });

    await t.test('rejette jours absents, horaires invalides et capacité nulle', () => {
      assert.throws(() => sessionController.parseForm(validSessionBody({ weekDays: [] })), /jour/i);
      assert.throws(() => sessionController.parseForm(validSessionBody({ startTime: '20:00', endTime: '18:00' })), /heure/i);
      assert.throws(() => sessionController.parseForm(validSessionBody({ capacity: '0' })), /capacit/i);
      assert.throws(() => sessionController.parseForm(validSessionBody({ platform: '' })), /plateforme/i);
    });

    await t.test('affiche les informations configurées et exclut les sessions non ouvertes', async () => {
      await sessionService.create(sessionController.parseForm(validSessionBody({
        name: 'Session brouillon',
        status: 'DRAFT',
        platform: '',
      })));
      privateUrl = `https://zoom.example.test/private-${unique}`;
      await prisma.classMeeting.create({
        data: {
          title: 'Réunion privée',
          startsAt: openSession.startDate,
          endsAt: new Date(openSession.startDate.getTime() + 3600000),
          privateMeetingUrl: privateUrl,
          trainingSessionId: openSession.id,
        },
      });

      server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(`${baseUrl}/formations/${course.slug}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /English for Bankers/);
      assert.match(html, /8 semaines/);
      assert.match(html, /150,50/);
      assert.match(html, /Lundi, Mercredi et Vendredi/i);
      assert.match(html, /18:00\s*–\s*20:00/);
      assert.match(html, /Africa\/Kinshasa/);
      assert.match(html, /Zoom/);
      assert.match(html, /Formation 100 % en ligne/);
      assert.match(html, /Session du soir/);
      assert.doesNotMatch(html, /Session brouillon/);
      assert.doesNotMatch(html, new RegExp(privateUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    await t.test('protège toutes les mutations administratives', async () => {
      const anonymous = await fetch(`${baseUrl}/admin/courses`, { redirect: 'manual' });
      assert.equal(anonymous.status, 302);
      assert.equal(anonymous.headers.get('location'), '/login');

      const suffix = String(Date.now()).slice(-7);
      const password = 'Protection@2026';
      const student = await prisma.user.create({
        data: {
          firstName: 'Protection',
          lastName: 'Étudiant',
          phoneNumber: `+24389${suffix}`,
          passwordHash: await bcrypt.hash(password, 12),
          role: 'STUDENT',
        },
      });
      studentId = student.id;
      const login = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        body: new URLSearchParams({ phoneNumber: student.phoneNumber, password }),
        redirect: 'manual',
      });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const forbidden = await fetch(`${baseUrl}/admin/courses`, {
        method: 'POST',
        headers: { Cookie: cookie },
        body: new URLSearchParams(courseBody),
      });
      assert.equal(forbidden.status, 403);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    for (const id of createdCourseIds.reverse()) await prisma.course.delete({ where: { id } }).catch(() => {});
    if (studentId) await prisma.user.delete({ where: { id: studentId } }).catch(() => {});
    await prisma.$disconnect();
  }
});
