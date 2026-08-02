require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const prisma = require('../src/utils/prisma');

const CONFIRMATION = 'DELETE_CERTAIN_TEST_FIXTURES';
const DEFINITIONS = [
  { title: 'Formation essai gratuit', prefix: 'essai-gratuit-', source: 'tests/freeTrialAttendance.test.js' },
  { title: 'Formation principale', prefix: 'student-principale-', source: 'tests/studentDashboard.test.js' },
  { title: 'Cours principal', prefix: 'pedago-principal-', source: 'tests/learningContent.test.js' },
  { title: 'Live principal', prefix: 'live-principal-', source: 'tests/liveMeetingLessons.test.js' },
  { title: 'Parcours étudiant existant', prefix: 'parcours-existant-', source: 'tests/existingStudentEnrollment.test.js' },
];

function embeddedTimestamp(slug, prefix) {
  const match = slug.match(new RegExp(`^${prefix}(\\d{13,})-\\d+$`));
  return match ? Number(match[1]) : null;
}

function classifyCourse(course) {
  const definition = DEFINITIONS.find((item) => course.title === item.title || course.slug.startsWith(item.prefix));
  if (!definition) return { classification: 'E', source: null, reason: 'Origine impossible à déterminer.' };
  const timestamp = embeddedTimestamp(course.slug, definition.prefix);
  const creationTime = new Date(course.createdAt).getTime();
  const exactIdentity = course.title === definition.title && timestamp !== null;
  const timestampMatches = timestamp !== null && Math.abs(timestamp - creationTime) <= 15 * 60 * 1000;
  if (exactIdentity && timestampMatches) {
    return { classification: 'A', source: definition.source, reason: 'Titre, préfixe de slug et horodatage correspondent exactement à la fixture.' };
  }
  return { classification: 'B', source: definition.source, reason: 'Nom ou préfixe connu, mais preuve complète insuffisante.' };
}

function protectedDependencyCount(dependencies) {
  return dependencies.enrollments + dependencies.payments + dependencies.attendances +
    dependencies.assessments + dependencies.modules + dependencies.assignments +
    dependencies.documents + dependencies.schedules + dependencies.academicCohorts;
}

async function auditFixtures(client = prisma) {
  const courses = await client.course.findMany({
    where: {
      OR: [
        ...DEFINITIONS.map(({ title }) => ({ title })),
        ...DEFINITIONS.map(({ prefix }) => ({ slug: { startsWith: prefix } })),
      ],
    },
    orderBy: { id: 'asc' },
    select: {
      id: true, title: true, slug: true, isPublished: true, lmsStatus: true, createdAt: true,
      _count: { select: {
        trainingSessions: true, enrollments: true, payments: true, assessments: true,
        modules: true, assignments: true, documents: true, schedules: true, academicCohorts: true,
      } },
    },
  });
  const audited = [];
  for (const course of courses) {
    const [sessionEnrollments, attendances] = await Promise.all([
      client.enrollment.count({ where: { trainingSession: { courseId: course.id } } }),
      client.attendance.count({ where: { enrollment: { trainingSession: { courseId: course.id } } } }),
    ]);
    const dependencies = {
      sessions: course._count.trainingSessions,
      enrollments: course._count.enrollments + sessionEnrollments,
      payments: course._count.payments,
      attendances,
      assessments: course._count.assessments,
      modules: course._count.modules,
      assignments: course._count.assignments,
      documents: course._count.documents,
      schedules: course._count.schedules,
      academicCohorts: course._count.academicCohorts,
    };
    const classification = classifyCourse(course);
    audited.push({
      id: course.id,
      title: course.title,
      slug: course.slug,
      status: course.lmsStatus,
      isPublished: course.isPublished,
      createdAt: course.createdAt,
      ...classification,
      dependencies,
      eligibleForDeletion: classification.classification === 'A' && protectedDependencyCount(dependencies) === 0,
    });
  }
  return audited;
}

function buildPlan(audit) {
  return {
    generatedAt: new Date().toISOString(),
    suspectCount: audit.length,
    certainCount: audit.filter((item) => item.classification === 'A').length,
    eligibleCourseIds: audit.filter((item) => item.eligibleForDeletion).map((item) => item.id),
    protected: audit.filter((item) => !item.eligibleForDeletion),
    courses: audit,
  };
}

function assertCleanupAllowed(env, confirmation) {
  if (env.NODE_ENV === 'production') throw new Error('Nettoyage de fixtures interdit en production.');
  if (confirmation !== CONFIRMATION) throw new Error(`Confirmation requise : --confirm=${CONFIRMATION}`);
  const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''));
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(databaseName) && env.ALLOW_FIXTURE_CLEANUP_ON_DEVELOPMENT !== 'true') {
    throw new Error('Nettoyage hors base _test refusé sans ALLOW_FIXTURE_CLEANUP_ON_DEVELOPMENT=true.');
  }
}

async function executeCleanup(client, env, confirmation) {
  assertCleanupAllowed(env, confirmation);
  return client.$transaction(async (tx) => {
    const audit = await auditFixtures(tx);
    const plan = buildPlan(audit);
    for (const courseId of plan.eligibleCourseIds) await tx.course.delete({ where: { id: courseId } });
    return { ...plan, deletedCourseIds: plan.eligibleCourseIds };
  });
}

function writeAuditLog(mode, payload) {
  const directory = path.resolve('audit-output');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `fixtures-${mode}.json`), JSON.stringify(payload, null, 2));
}

async function main(mode = process.argv[2] || 'audit') {
  if (mode === 'cleanup') {
    const confirmation = process.argv.find((value) => value.startsWith('--confirm='))?.split('=')[1];
    const result = await executeCleanup(prisma, process.env, confirmation);
    writeAuditLog('cleanup', result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const audit = await auditFixtures(prisma);
  const plan = buildPlan(audit);
  const label = mode === 'dry-run' ? 'dry-run' : 'audit';
  writeAuditLog(label, plan);
  console.log(JSON.stringify(plan, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[FIXTURE_CLEANUP_REFUSED] ${error.message}`);
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
}

module.exports = {
  CONFIRMATION, DEFINITIONS, embeddedTimestamp, classifyCourse, protectedDependencyCount,
  auditFixtures, buildPlan, assertCleanupAllowed, executeCleanup,
};
