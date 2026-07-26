const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const service = require('../src/services/enrollmentReminderService');

const future = (hours) => new Date(Date.now() + hours * 3600000);

test('synchronisation des rappels avec les inscriptions', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const userIds = [], courseIds = [];
  async function user(index) {
    const row = await prisma.user.create({ data: { firstName: 'Sync', lastName: `User${index}`, phoneNumber: `+1202666${index}${key.slice(-4)}`, passwordHash: 'test-only', role: 'STUDENT' } });
    userIds.push(row.id); return row;
  }
  try {
    const [first, second] = await Promise.all([user(1), user(2)]);
    const course = await prisma.course.create({ data: { title: `Sync ${key}`, slug: `sync-${key}`, isPublished: true } }); courseIds.push(course.id);
    const session = await prisma.trainingSession.create({ data: { name: 'Cohorte Sync', courseId: course.id, startDate: future(1), endDate: future(500), registrationDeadline: future(1), capacity: 10, status: 'OPEN' } });
    const otherSession = await prisma.trainingSession.create({ data: { name: 'Autre cohorte', courseId: course.id, startDate: future(1), endDate: future(500), registrationDeadline: future(1), capacity: 10, status: 'OPEN' } });
    const meeting = await prisma.classMeeting.create({ data: { title: 'Séance future', startsAt: future(26), endsAt: future(27), privateMeetingUrl: 'https://example.test/private', trainingSessionId: session.id } });
    const nearMeeting = await prisma.classMeeting.create({ data: { title: 'Séance proche', startsAt: future(1), endsAt: future(2), privateMeetingUrl: 'https://example.test/private', trainingSessionId: session.id } });
    await prisma.classMeeting.create({ data: { title: 'Autre session', startsAt: future(26), endsAt: future(27), privateMeetingUrl: 'https://example.test/private', trainingSessionId: otherSession.id } });
    const globalAssignment = await prisma.assignment.create({ data: { courseId: course.id, title: 'Global', instructions: 'Consignes', maxScore: 20, dueAt: future(26), isPublished: true } });
    await prisma.assignment.create({ data: { courseId: course.id, trainingSessionId: otherSession.id, title: 'Autre cohorte', instructions: 'Consignes', maxScore: 20, dueAt: future(26), isPublished: true } });
    await prisma.assignment.create({ data: { courseId: course.id, title: 'Brouillon', instructions: 'Consignes', maxScore: 20, dueAt: future(26), isPublished: false } });
    const firstEnrollment = await prisma.enrollment.create({ data: { userId: first.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE' } });
    const secondEnrollment = await prisma.enrollment.create({ data: { userId: second.id, trainingSessionId: session.id, status: 'CONFIRMED' } });

    await t.test('crée uniquement les rappels futurs applicables et reste idempotent', async () => {
      await service.synchronizeEnrollmentReminders(firstEnrollment.id);
      await service.synchronizeEnrollmentReminders(firstEnrollment.id);
      const rows = await prisma.scheduledReminder.findMany({ where: { userId: first.id, status: 'PENDING' } });
      assert.equal(rows.filter(x => x.relatedId === meeting.id).length, 2);
      assert.equal(rows.filter(x => x.relatedId === nearMeeting.id).length, 1);
      assert.equal(rows.filter(x => x.relatedId === globalAssignment.id).length, 1);
      assert.equal(new Set(rows.map(x => x.deduplicationKey)).size, rows.length);
      assert.ok(rows.every(x => !x.message.includes('example.test') && x.actionUrl.startsWith('/')));
    });
    await t.test('annule seulement les rappels de l’inscription devenue inéligible', async () => {
      await service.synchronizeEnrollmentReminders(secondEnrollment.id);
      await prisma.enrollment.update({ where: { id: firstEnrollment.id }, data: { status: 'PAYMENT_REQUIRED' } });
      await service.synchronizeEnrollmentReminders(firstEnrollment.id);
      assert.equal(await prisma.scheduledReminder.count({ where: { userId: first.id, status: 'PENDING' } }), 0);
      assert.ok(await prisma.scheduledReminder.count({ where: { userId: second.id, status: 'PENDING' } }) > 0);
    });
    await t.test('recrée les rappels après confirmation et exclut un devoir remis', async () => {
      await prisma.assignmentSubmission.create({ data: { assignmentId: globalAssignment.id, enrollmentId: firstEnrollment.id, answerText: 'Réponse', status: 'SUBMITTED', submittedAt: new Date() } });
      await prisma.enrollment.update({ where: { id: firstEnrollment.id }, data: { status: 'CONFIRMED' } });
      await service.synchronizeEnrollmentReminders(firstEnrollment.id);
      assert.ok(await prisma.scheduledReminder.count({ where: { userId: first.id, relatedEntity: 'CLASS_MEETING', status: 'PENDING' } }) > 0);
      assert.equal(await prisma.scheduledReminder.count({ where: { userId: first.id, relatedEntity: 'ASSIGNMENT', status: 'PENDING' } }), 0);
    });
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  }
});
