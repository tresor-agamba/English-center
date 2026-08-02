const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONFIRMATION, classifyCourse, auditFixtures, buildPlan, assertCleanupAllowed, executeCleanup,
} = require('../scripts/cleanupTestFixtures');
const { assertSafeTestDatabase } = require('../src/utils/testDatabaseGuard');

function certainCourse(overrides = {}) {
  const timestamp = Date.now();
  return {
    id: 101,
    title: 'Formation essai gratuit',
    slug: `essai-gratuit-${timestamp}-1234`,
    isPublished: true,
    lmsStatus: 'DRAFT',
    createdAt: new Date(timestamp),
    _count: {
      trainingSessions: 1, enrollments: 0, payments: 0, assessments: 0,
      modules: 0, assignments: 0, documents: 0, schedules: 0, academicCohorts: 0,
    },
    ...overrides,
  };
}

function fakeClient(course, { sessionEnrollments = 0, attendances = 0 } = {}) {
  const deleted = [];
  const tx = {
    course: {
      findMany: async () => [course],
      delete: async ({ where }) => { deleted.push(where.id); return { id: where.id }; },
    },
    enrollment: { count: async () => sessionEnrollments },
    attendance: { count: async () => attendances },
  };
  return {
    deleted,
    ...tx,
    $transaction: async (callback) => callback(tx),
  };
}

test('isolation et nettoyage sécurisé des fixtures', async (t) => {
  await t.test('classe A uniquement avec titre, préfixe et horodatage exacts', () => {
    assert.equal(classifyCourse(certainCourse()).classification, 'A');
    assert.equal(classifyCourse(certainCourse({ slug: 'essai-gratuit-manuel' })).classification, 'B');
    assert.equal(classifyCourse({ ...certainCourse(), title: 'Cours réel', slug: 'cours-reel' }).classification, 'E');
  });

  await t.test('audit et dry-run ne suppriment rien', async () => {
    const client = fakeClient(certainCourse());
    const audit = await auditFixtures(client);
    const plan = buildPlan(audit);
    assert.deepEqual(plan.eligibleCourseIds, [101]);
    assert.deepEqual(client.deleted, []);
  });

  await t.test('suppression transactionnelle limitée aux fixtures certaines sans dépendance protégée', async () => {
    const client = fakeClient(certainCourse());
    const result = await executeCleanup(client, {
      NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/english_center_test',
    }, CONFIRMATION);
    assert.deepEqual(result.deletedCourseIds, [101]);
    assert.deepEqual(client.deleted, [101]);
  });

  await t.test('refuse une inscription ou une présence liée', async () => {
    for (const dependency of [{ sessionEnrollments: 1 }, { attendances: 1 }]) {
      const client = fakeClient(certainCourse(), dependency);
      const result = await executeCleanup(client, {
        NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/english_center_test',
      }, CONFIRMATION);
      assert.deepEqual(result.deletedCourseIds, []);
      assert.deepEqual(client.deleted, []);
    }
  });

  await t.test('refuse un paiement ou une évaluation liés', async () => {
    for (const field of ['payments', 'assessments']) {
      const course = certainCourse();
      course._count[field] = 1;
      const client = fakeClient(course);
      const result = await executeCleanup(client, {
        NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/english_center_test',
      }, CONFIRMATION);
      assert.deepEqual(result.deletedCourseIds, []);
      assert.deepEqual(client.deleted, []);
    }
  });

  await t.test('refuse production, confirmation absente et base non dédiée', () => {
    assert.throws(() => assertCleanupAllowed({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/english_center_test' }, CONFIRMATION), /production/i);
    assert.throws(() => assertCleanupAllowed({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/english_center_test' }), /Confirmation/);
    assert.throws(() => assertCleanupAllowed({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost/english_center' }, CONFIRMATION), /hors base _test/i);
  });

  await t.test('refuse TEST_DATABASE_URL absente, identique ou sans suffixe test', () => {
    const development = 'postgresql://u:p@localhost/english_center';
    assert.throws(() => assertSafeTestDatabase({ DATABASE_URL: development }), (error) => error.code === 'TEST_DATABASE_URL_MISSING');
    assert.throws(() => assertSafeTestDatabase({ DATABASE_URL: development, TEST_DATABASE_URL: development }), (error) => error.code === 'TEST_DATABASE_MATCHES_DEVELOPMENT');
    assert.throws(() => assertSafeTestDatabase({ DATABASE_URL: development, TEST_DATABASE_URL: 'postgresql://u:p@localhost/english_center_ci' }), (error) => error.code === 'TEST_DATABASE_NAME_UNSAFE');
  });

  await t.test('accepte et sélectionne effectivement une base _test distincte', () => {
    const result = assertSafeTestDatabase({
      DATABASE_URL: 'postgresql://u:p@localhost/english_center',
      TEST_DATABASE_URL: 'postgresql://u:p@localhost/english_center_test',
    });
    assert.equal(result.test.databaseName, 'english_center_test');
    assert.notEqual(result.test.identity, result.development.identity);
  });
});
