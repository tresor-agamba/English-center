require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const reports = require('../src/services/reportService');
const { resolvePeriod } = require('../src/services/reportPeriodService');
const csv = require('../src/services/reportCsvService');

const key = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let admin, teacher, student, course, cohort, group, enrollment, session;
test('Phase 8 — rapports simples', async (t) => {
  [admin, teacher, student] = await Promise.all([
    prisma.user.create({ data: { firstName: 'Admin', lastName: 'Report', phoneNumber: `+243830${key}`, passwordHash: 'x', role: 'ADMIN' } }),
    prisma.user.create({ data: { firstName: 'Teacher', lastName: 'Report', phoneNumber: `+243831${key}`, passwordHash: 'x', role: 'TEACHER' } }),
    prisma.user.create({ data: { firstName: '=Student', lastName: 'Report', phoneNumber: `+243832${key}`, passwordHash: 'x', role: 'STUDENT' } }),
  ]);
  course = await prisma.course.create({ data: { title: 'Reports', slug: `reports-${key}`, isPublished: true } });
  cohort = await prisma.academicCohort.create({ data: { name: 'Reports', code: `REP-${key}`, level: 'LEVEL_1', courseId: course.id, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), capacity: 5, status: 'ACTIVE' } });
  group = await prisma.academicGroup.create({ data: { cohortId: cohort.id, name: 'R', code: 'R', capacity: 5, modality: 'ONLINE', status: 'ACTIVE' } });
  enrollment = await prisma.academicEnrollment.create({ data: { studentId: student.id, cohortId: cohort.id, groupId: group.id, status: 'ACTIVE' } });
  await prisma.academicTeacherAssignment.create({ data: { teacherId: teacher.id, cohortId: cohort.id, groupId: group.id, role: 'PRIMARY', startsAt: new Date('2026-01-01'), assignedById: admin.id } });
  session = await prisma.academicSession.create({ data: { groupId: group.id, teacherId: teacher.id, title: 'Séance', startsAt: new Date(), endsAt: new Date(Date.now() + 3600000), modality: 'ONLINE', status: 'COMPLETED' } });

  await t.test('valide les périodes prédéfinies et personnalisées', () => {
    assert.equal(resolvePeriod({}).period, 'THIS_MONTH');
    assert.equal(resolvePeriod({ period: 'TODAY' }).period, 'TODAY');
    assert.throws(() => resolvePeriod({ period: 'CUSTOM', startDate: '2026-02-02', endDate: '2026-01-01' }), /après/);
  });
  await t.test('calcule le résumé administrateur', async () => {
    const result = await reports.summary({ period: 'THIS_MONTH' });
    assert.ok(result.totalStudents >= 1); assert.ok(result.activeGroups >= 1); assert.ok(Array.isArray(result.finance));
  });
  await t.test('compte les étudiants par niveau et inscriptions actives', async () => {
    const result = await reports.students({ period: 'THIS_MONTH', level: 'LEVEL_1' });
    assert.ok(result.active >= 1); assert.ok(result.byLevel.some((x) => x.key === 'LEVEL_1'));
    await assert.rejects(() => reports.students({ level: 'LEVEL_4' }), /Niveau/);
  });
  await t.test('calcule les présences sans TECHNICAL_ISSUE au dénominateur', async () => {
    for (const status of ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'TECHNICAL_ISSUE']) {
      const other = status === 'PRESENT' ? enrollment : await prisma.academicEnrollment.create({ data: { studentId: (await prisma.user.create({ data: { firstName: status, lastName: 'R', phoneNumber: `+24384${status.length}${key}${Math.random()}`, passwordHash: 'x', role: 'STUDENT' } })).id, cohortId: cohort.id, groupId: group.id, status: 'ACTIVE' } });
      await prisma.academicAttendance.create({ data: { sessionId: session.id, enrollmentId: other.id, status, recordedById: teacher.id } });
    }
    const result = await reports.attendance({ period: 'THIS_MONTH', groupId: group.id });
    assert.equal(result.denominator, 3); assert.equal(result.attendanceRate.toFixed(2), '66.67'); assert.equal(result.counts.TECHNICAL_ISSUE, 1); assert.equal(result.counts.EXCUSED, 1);
  });
  await t.test('exclut les évaluations non notées des moyennes', async () => {
    const result = await reports.evaluations({ period: 'THIS_MONTH' });
    assert.ok(Array.isArray(result.evaluationsByMode));
    assert.equal(result.evaluationsByMode.every((x) => Number.isFinite(x.average)), true);
  });
  await t.test('agrège la progression LMS existante', async () => {
    const result = await reports.lms({ period: 'THIS_MONTH' });
    assert.ok(result.publishedCourses >= 1); assert.ok(result.timeSpentSeconds >= 0);
  });
  await t.test('sépare strictement USD et CDF', async () => {
    await prisma.studentInvoice.createMany({ data: [
      { number: `USD-${key}`, studentId: student.id, academicEnrollmentId: enrollment.id, level: 'LEVEL_1', totalAmount: 100, paidAmount: 40, balanceAmount: 60, currency: 'USD' },
      { number: `CDF-${key}`, studentId: student.id, academicEnrollmentId: enrollment.id, level: 'LEVEL_1', totalAmount: 10000, paidAmount: 3000, balanceAmount: 7000, currency: 'CDF' },
    ] });
    const result = await reports.finances({ period: 'THIS_MONTH' });
    const usd = result.totals.find((x) => x.currency === 'USD'), cdf = result.totals.find((x) => x.currency === 'CDF');
    assert.ok(usd && cdf); assert.notEqual(usd._sum.paidAmount.toString(), cdf._sum.paidAmount.toString());
  });
  await t.test('produit les rapports certificats et enseignants sans finance enseignante', async () => {
    const [cert, teach] = await Promise.all([reports.certificates({ period: 'THIS_MONTH' }), reports.teachers({ period: 'THIS_MONTH', teacherId: teacher.id })]);
    assert.ok(cert.requests >= 0); assert.ok(teach.assignments >= 1); assert.equal(Object.hasOwn(teach, 'finance'), false);
  });
  await t.test('exporte en CSV UTF-8 avec protection contre les formules', async () => {
    assert.equal(csv.safeCell('=2+2'), '"\'=2+2"');
    const output = await reports.exportCsv('students', { period: 'THIS_MONTH' }, admin.id);
    assert.ok(output.startsWith('\uFEFF')); assert.match(output, /'=Student/);
  });
  await t.test('limite les exports et refuse les types non autorisés', async () => {
    assert.equal(csv.MAX_EXPORT_ROWS, 5000);
    await assert.rejects(() => reports.exportCsv('secrets', {}, admin.id), /non autorisé/);
  });

  await prisma.financialAuditLog.deleteMany({ where: { actorId: admin.id } });
  await prisma.studentInvoice.deleteMany({ where: { studentId: student.id } });
  await prisma.academicAttendance.deleteMany({ where: { sessionId: session.id } });
  await prisma.academicSession.delete({ where: { id: session.id } });
  await prisma.academicTeacherAssignment.deleteMany({ where: { cohortId: cohort.id } });
  const extraEnrollments = await prisma.academicEnrollment.findMany({ where: { cohortId: cohort.id }, select: { studentId: true } });
  await prisma.academicEnrollment.deleteMany({ where: { cohortId: cohort.id } });
  await prisma.academicGroup.delete({ where: { id: group.id } });
  await prisma.academicCohort.delete({ where: { id: cohort.id } });
  await prisma.course.delete({ where: { id: course.id } });
  await prisma.user.deleteMany({ where: { id: { in: [...extraEnrollments.map((x) => x.studentId), admin.id, teacher.id] } } });
});
