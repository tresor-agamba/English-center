const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const app = require('../src/app');

test('page des evaluations orales etudiante', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const phoneSuffix = String(Date.now()).slice(-7);
  const password = 'OralPage@2026';
  const passwordHash = await bcrypt.hash(password, 12);
  const userIds = [];
  const courseIds = [];
  let server;

  async function createUser(index, role = 'STUDENT') {
    const user = await prisma.user.create({
      data: {
        firstName: 'Oral',
        lastName: `Page${index}`,
        phoneNumber: `+2438${index}${phoneSuffix}`,
        passwordHash,
        role,
      },
    });
    userIds.push(user.id);
    return user;
  }

  async function enroll(user, label) {
    const course = await prisma.course.create({
      data: { title: `Cours oral ${label} ${key}`, slug: `oral-page-${label}-${key}`, isPublished: true },
    });
    courseIds.push(course.id);
    const session = await prisma.trainingSession.create({
      data: {
        name: `Session orale ${label}`,
        courseId: course.id,
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2027-12-31T00:00:00Z'),
        registrationDeadline: new Date('2025-12-01T00:00:00Z'),
        capacity: 20,
        status: 'ONGOING',
      },
    });
    await prisma.enrollment.create({ data: { userId: user.id, trainingSessionId: session.id, status: 'CONFIRMED' } });
    return { course, session };
  }

  async function login(baseUrl, user) {
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      body: new URLSearchParams({ phoneNumber: user.phoneNumber, password }),
      redirect: 'manual',
    });
    return response.headers.get('set-cookie')?.split(';')[0];
  }

  try {
    const emptyStudent = await createUser(1);
    const assessedStudent = await createUser(2);
    const admin = await createUser(3, 'ADMIN');
    await enroll(emptyStudent, 'vide');
    const assessed = await enroll(assessedStudent, 'publie');
    const assessment = await prisma.assessment.create({
      data: {
        title: `Evaluation orale disponible ${key}`,
        instructions: 'Repondez oralement.',
        mode: 'RECORDED_ORAL',
        status: 'PUBLISHED',
        courseId: assessed.course.id,
        trainingSessionId: assessed.session.id,
        createdById: admin.id,
        totalPoints: 20,
        passingScore: 10,
        maxRecordingSeconds: 60,
        publishedAt: new Date(),
      },
    });

    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const emptyCookie = await login(baseUrl, emptyStudent);
    const assessedCookie = await login(baseUrl, assessedStudent);
    const adminCookie = await login(baseUrl, admin);

    await t.test('redirige un visiteur non authentifie', async () => {
      const response = await fetch(`${baseUrl}/student/oral-assessments`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/login');
    });

    await t.test('refuse un autre role', async () => {
      const response = await fetch(`${baseUrl}/student/oral-assessments`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 403);
    });

    await t.test('retourne 200 et un etat vide avec une inscription active sans evaluation', async () => {
      const response = await fetch(`${baseUrl}/student/oral-assessments`, { headers: { Cookie: emptyCookie } });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /Aucune evaluation orale n.est disponible actuellement|Aucune évaluation orale n.est disponible actuellement/);
    });

    await t.test('retourne 200 et affiche une evaluation publiee attribuee', async () => {
      const response = await fetch(`${baseUrl}/student/oral-assessments`, { headers: { Cookie: assessedCookie } });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, new RegExp(assessment.title));
      assert.match(html, new RegExp(`/student/oral-assessments/${assessment.id}`));
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.assessment.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => {});
    await prisma.enrollment.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await prisma.trainingSession.deleteMany({ where: { courseId: { in: courseIds } } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  }
});
