const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const courseService = require('../src/services/courseService');
const publicCourses = require('../src/services/publicCourseService');

function completeData(unique) {
  return { title: `Publication contrôlée ${unique}`, slug: `publication-controlee-${unique}`,
    shortDescription: 'Une description publique valide.', level: 'Intermédiaire',
    durationValue: 8, durationUnit: 'WEEKS', price: '100.00', currency: 'USD',
    pricingMode: 'ONE_TIME', pricingActive: true };
}

test('publication administrative explicite des formations', async (t) => {
  const unique = `${Date.now()}-${process.pid}`;
  const ids = [];
  try {
    const draft = await prisma.course.create({ data: completeData(unique) });
    ids.push(draft.id);
    await t.test('une nouvelle formation complète reste invisible en brouillon', async () => {
      assert.equal((await publicCourses.listPublished()).some((course) => course.id === draft.id), false);
    });
    await t.test('une formation incomplète ne peut pas être publiée', async () => {
      const incomplete = await prisma.course.create({ data: { title: `Incomplète ${unique}`, slug: `incomplete-${unique}` } });
      ids.push(incomplete.id);
      await assert.rejects(() => courseService.publish(incomplete.id), /Informations manquantes/);
      assert.equal((await prisma.course.findUnique({ where: { id: incomplete.id } })).isPublished, false);
    });
    await t.test('publication puis dépublication contrôlent le catalogue sans doublon', async () => {
      await courseService.publish(draft.id);
      assert.equal((await publicCourses.listPublished()).filter((course) => course.id === draft.id).length, 1);
      await courseService.unpublish(draft.id);
      assert.equal((await publicCourses.listPublished()).some((course) => course.id === draft.id), false);
    });
    await t.test('une formation archivée et ses sessions restent invisibles', async () => {
      await courseService.publish(draft.id);
      await prisma.trainingSession.create({ data: { name: 'Session publique temporaire', courseId: draft.id,
        startDate: new Date(Date.now() + 86400000), endDate: new Date(Date.now() + 172800000),
        registrationDeadline: new Date(Date.now() + 43200000), capacity: 10, status: 'OPEN' } });
      await courseService.archive(draft.id);
      assert.equal((await publicCourses.listPublished()).some((course) => course.id === draft.id), false);
      assert.equal((await publicCourses.listUpcomingSessions(6)).some((session) => session.courseId === draft.id), false);
    });
  } finally {
    for (const id of ids.reverse()) await prisma.course.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
