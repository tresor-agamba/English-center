const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const courses = require('../src/services/courseService');
const { parseForm } = require('../src/controllers/adminCourseController');

test('conversion des formations SIMPLE historiques : persistance et refus atomique', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.match(new URL(process.env.DATABASE_URL).pathname, /[_-]test(?:$|[_-])/);
  const ids = [];
  async function create(accessPolicy = 'LEGACY_STAGED') {
    const course = await prisma.course.create({ data: {
      title: 'Anglais général', slug: `conversion-regression-${Date.now()}-${process.pid}-${ids.length}`,
      structureType: 'SIMPLE', numberOfLevels: null, sessionCount: null, accessPolicy,
      price: '60', durationValue: 24, durationUnit: 'HOURS', currency: 'USD',
      courseType: 'GENERAL_ENGLISH', pricingMode: 'ONE_TIME', pricingActive: true,
    } });
    ids.push(course.id);
    return course;
  }
  const requested = course => parseForm({ ...course, structureType: 'LEVEL_BASED', numberOfLevels: '3', sessionCount: '16',
    price: '60', durationValue: '24', pricingState: 'AVAILABLE' });
  try {
    for (const policy of ['LEGACY_STAGED', 'FULL_PAYMENT']) await t.test(`sans dépendances : conversion persistée, politique ${policy} conservée`, async () => {
      const course = await create(policy);
      const data = requested(course);
      assert.equal(data.structureType, 'LEVEL_BASED');
      assert.equal(data.numberOfLevels, 3);
      assert.equal(data.sessionCount, 16);
      await courses.update(course.id, data);
      const [stored] = await prisma.$queryRaw`SELECT structure_type, number_of_levels, session_count, access_policy, price, duration_value FROM courses WHERE id = ${course.id}`;
      assert.deepEqual({ ...stored, price: String(stored.price) }, {
        structure_type: 'LEVEL_BASED', number_of_levels: 3, session_count: 16, access_policy: policy, price: '60', duration_value: 24,
      });
    });
    await t.test('session sans niveau : message contextualisé et aucune écriture partielle', async () => {
      const course = await create();
      const session = await prisma.trainingSession.create({ data: { courseId: course.id, name: 'Ancienne session',
        startDate: new Date('2026-10-01'), endDate: new Date('2026-11-01'), registrationDeadline: new Date('2026-09-30'), capacity: 20 } });
      await assert.rejects(courses.update(course.id, { ...requested(course), price: '75', title: 'Titre à ne pas enregistrer' }), error => {
        assert.equal(error.statusCode, 400);
        assert.match(error.message, /Modification refusée/);
        assert.ok(error.message.includes(`« Ancienne session » (#${session.id})`));
        assert.match(error.message, /ne possède pas de numéro de niveau/);
        assert.match(error.message, /Créez une nouvelle formation/);
        return true;
      });
      assert.deepEqual(await prisma.course.findUnique({ where: { id: course.id } }), course);
      assert.deepEqual(await prisma.trainingSession.findUnique({ where: { id: session.id } }), session);
      // An unrelated correction remains possible on the historical course.
      await courses.update(course.id, { title: 'Anglais général corrigé' });
      assert.equal((await courses.findById(course.id)).structureType, 'SIMPLE');
    });
  } finally {
    await prisma.course.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
});
