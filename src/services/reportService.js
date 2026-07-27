const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { resolvePeriod, ReportFilterError } = require('./reportPeriodService');
const csv = require('./reportCsvService');
const LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
const idFilter = (value, label) => {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new ReportFilterError('INVALID_FILTER', `${label} invalide.`);
  return parsed;
};
function filters(query = {}) {
  const level = query.level || undefined;
  if (level && !LEVELS.includes(level)) throw new ReportFilterError('INVALID_LEVEL', 'Niveau invalide.');
  return { level, cohortId: idFilter(query.cohortId, 'Cohorte'), groupId: idFilter(query.groupId, 'Groupe'), teacherId: idFilter(query.teacherId, 'Enseignant') };
}
async function summary(query) {
  const range = resolvePeriod(query);
  const [totalStudents, activeStudents, activeTeachers, activeCohorts, activeGroups, publishedCourses, scheduledSessions, unpaidInvoices, finance, issuedCertificates] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.user.count({ where: { role: 'STUDENT', isActive: true } }),
    prisma.user.count({ where: { role: 'TEACHER', isActive: true } }),
    prisma.academicCohort.count({ where: { status: 'ACTIVE' } }),
    prisma.academicGroup.count({ where: { status: 'ACTIVE' } }),
    prisma.course.count({ where: { isPublished: true } }),
    prisma.academicSession.count({ where: { status: 'SCHEDULED', startsAt: range.dateWhere } }),
    prisma.studentInvoice.count({ where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } }),
    prisma.studentInvoice.groupBy({ by: ['currency'], _sum: { paidAmount: true, balanceAmount: true } }),
    prisma.certificate.count({ where: { status: 'ISSUED', issuedAt: range.dateWhere } }),
  ]);
  return { range, totalStudents, activeStudents, activeTeachers, activeCohorts, activeGroups, publishedCourses, scheduledSessions, unpaidInvoices, finance, issuedCertificates };
}
async function students(query) {
  const range = resolvePeriod(query), f = filters(query);
  const academicWhere = { ...(f.level ? { cohort: { level: f.level } } : {}), ...(f.cohortId ? { cohortId: f.cohortId } : {}), ...(f.groupId ? { groupId: f.groupId } : {}) };
  const [total, newStudents, active, suspended, completed, byLevel, byCohort, byGroup] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.user.count({ where: { role: 'STUDENT', createdAt: range.dateWhere } }),
    prisma.academicEnrollment.count({ where: { ...academicWhere, status: 'ACTIVE' } }),
    prisma.academicEnrollment.count({ where: { ...academicWhere, status: 'SUSPENDED' } }),
    prisma.academicEnrollment.count({ where: { ...academicWhere, status: 'COMPLETED' } }),
    prisma.$queryRaw`SELECT c.level::text AS key, COUNT(*)::int AS count FROM academic_enrollments e JOIN academic_cohorts c ON c.id=e.cohort_id WHERE e.status='ACTIVE' GROUP BY c.level ORDER BY c.level`,
    prisma.academicEnrollment.groupBy({ by: ['cohortId'], where: { ...academicWhere, status: 'ACTIVE' }, _count: { _all: true } }),
    prisma.academicEnrollment.groupBy({ by: ['groupId'], where: { ...academicWhere, status: 'ACTIVE', groupId: { not: null } }, _count: { _all: true } }),
  ]);
  return { range, total, newStudents, active, suspended, completed, byLevel, byCohort, byGroup };
}
async function academic(query) {
  const range = resolvePeriod(query), f = filters(query);
  const cohortWhere = { ...(f.level ? { level: f.level } : {}), ...(f.cohortId ? { id: f.cohortId } : {}) };
  const groupWhere = { ...(f.groupId ? { id: f.groupId } : {}), cohort: cohortWhere, ...(f.teacherId ? { teachers: { some: { teacherId: f.teacherId, removedAt: null } } } : {}) };
  const [cohortsActive, groupsActive, scheduled, completed, cancelled, studentsByGroup, teachersAssigned, activeEnrollments, transfers] = await Promise.all([
    prisma.academicCohort.count({ where: { ...cohortWhere, status: 'ACTIVE' } }),
    prisma.academicGroup.count({ where: { ...groupWhere, status: 'ACTIVE' } }),
    prisma.academicSession.count({ where: { group: groupWhere, status: 'SCHEDULED', startsAt: range.dateWhere } }),
    prisma.academicSession.count({ where: { group: groupWhere, status: 'COMPLETED', startsAt: range.dateWhere } }),
    prisma.academicSession.count({ where: { group: groupWhere, status: 'CANCELLED', startsAt: range.dateWhere } }),
    prisma.academicEnrollment.groupBy({ by: ['groupId'], where: { status: 'ACTIVE', group: groupWhere }, _count: { _all: true } }),
    prisma.academicTeacherAssignment.count({ where: { removedAt: null, group: groupWhere } }),
    prisma.academicEnrollment.count({ where: { status: 'ACTIVE', group: groupWhere } }),
    prisma.academicGroupTransfer.count({ where: { transferredAt: range.dateWhere, toGroup: groupWhere } }),
  ]);
  return { range, cohortsActive, groupsActive, scheduled, completed, cancelled, studentsByGroup, teachersAssigned, activeEnrollments, transfers };
}
async function attendance(query) {
  const range = resolvePeriod(query), f = filters(query);
  const where = { createdAt: range.dateWhere, ...(f.groupId ? { session: { groupId: f.groupId } } : {}), ...(f.teacherId ? { session: { teacherId: f.teacherId } } : {}) };
  const grouped = await prisma.academicAttendance.groupBy({ by: ['status'], where, _count: { _all: true } });
  const counts = Object.fromEntries(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'TECHNICAL_ISSUE'].map((status) => [status, grouped.find((x) => x.status === status)?._count._all || 0]));
  const denominator = counts.PRESENT + counts.LATE + counts.ABSENT;
  return { range, counts, denominator, attendanceRate: denominator ? ((counts.PRESENT + counts.LATE) / denominator) * 100 : 0, absenceRate: denominator ? (counts.ABSENT / denominator) * 100 : 0, denominatorDefinition: 'PRESENT + LATE + ABSENT' };
}
async function evaluations(query) {
  const range = resolvePeriod(query), f = filters(query);
  const assessmentWhere = f.teacherId ? { createdById: f.teacherId } : {};
  const [created, submitted, graded, evaluationsByMode] = await Promise.all([
    prisma.assessment.count({ where: { createdAt: range.dateWhere, ...assessmentWhere } }),
    prisma.assessmentAttempt.count({ where: { submittedAt: range.dateWhere, assessment: assessmentWhere } }),
    prisma.assessmentEvaluation.count({ where: { status: 'PUBLISHED', publishedAt: range.dateWhere, assessment: assessmentWhere } }),
    f.teacherId
      ? prisma.$queryRaw`SELECT a.mode::text AS mode, AVG(e.overall_score)::float AS average, COUNT(*)::int AS graded, COUNT(*) FILTER (WHERE e.decision='PASSED')::int AS passed FROM assessment_evaluations e JOIN assessments a ON a.id=e.assessment_id WHERE e.status='PUBLISHED' AND e.published_at BETWEEN ${range.start} AND ${range.end} AND a.created_by_id=${f.teacherId} GROUP BY a.mode`
      : prisma.$queryRaw`SELECT a.mode::text AS mode, AVG(e.overall_score)::float AS average, COUNT(*)::int AS graded, COUNT(*) FILTER (WHERE e.decision='PASSED')::int AS passed FROM assessment_evaluations e JOIN assessments a ON a.id=e.assessment_id WHERE e.status='PUBLISHED' AND e.published_at BETWEEN ${range.start} AND ${range.end} GROUP BY a.mode`,
  ]);
  const successDenominator = evaluationsByMode.reduce((s, x) => s + x.graded, 0);
  return { range, created, submitted, graded, pendingGrading: Math.max(0, submitted - graded), evaluationsByMode, successRate: successDenominator ? evaluationsByMode.reduce((s, x) => s + x.passed, 0) / successDenominator * 100 : 0 };
}
async function lms(query) {
  const range = resolvePeriod(query);
  const [publishedCourses, started, completedLessons, time, suspended] = await Promise.all([
    prisma.course.count({ where: { isPublished: true } }),
    prisma.lessonProgress.groupBy({ by: ['enrollmentId'], where: { openedAt: range.dateWhere } }),
    prisma.lessonProgress.count({ where: { completedAt: range.dateWhere } }),
    prisma.lessonProgress.aggregate({ where: { updatedAt: range.dateWhere }, _sum: { timeSpentSeconds: true }, _avg: { timeSpentSeconds: true } }),
    prisma.academicEnrollment.count({ where: { status: 'SUSPENDED' } }),
  ]);
  return { range, publishedCourses, studentsStarted: started.length, completedLessons, timeSpentSeconds: time._sum.timeSpentSeconds || 0, averageTimeSeconds: time._avg.timeSpentSeconds || 0, suspendedAccess: suspended };
}
async function finances(query) {
  const range = resolvePeriod(query);
  const [totals, statuses, methods, byType, periodPayments] = await Promise.all([
    prisma.studentInvoice.groupBy({ by: ['currency'], _sum: { totalAmount: true, paidAmount: true, balanceAmount: true } }),
    prisma.studentInvoice.groupBy({ by: ['currency', 'status'], _count: { _all: true } }),
    prisma.studentPayment.groupBy({ by: ['currency', 'method'], where: { paidAt: range.dateWhere }, _sum: { amount: true } }),
    prisma.studentInvoiceLine.groupBy({ by: ['currency', 'type'], _sum: { amount: true } }),
    prisma.studentPayment.groupBy({ by: ['currency'], where: { paidAt: range.dateWhere }, _sum: { amount: true } }),
  ]);
  return { range, totals, statuses, methods, byType, periodPayments };
}
async function certificates(query) {
  const range = resolvePeriod(query);
  const [requests, paid, issued, revoked, issuedByLevel] = await Promise.all([
    prisma.certificateRequest.count(), prisma.certificatePayment.count({ where: { status: 'CONFIRMED' } }),
    prisma.certificate.count({ where: { status: 'ISSUED', issuedAt: range.dateWhere } }),
    prisma.certificate.count({ where: { status: 'REVOKED' } }),
    prisma.$queryRaw`SELECT c.level::text AS level, COUNT(*)::int AS count FROM certificates cert JOIN certificate_requests cr ON cr.id=cert.certificate_request_id JOIN enrollments e ON e.id=cr.enrollment_id JOIN training_sessions ts ON ts.id=e.training_session_id JOIN academic_cohorts c ON c.course_id=ts.course_id WHERE cert.status='ISSUED' AND cert.issued_at BETWEEN ${range.start} AND ${range.end} GROUP BY c.level`,
  ]);
  return { range, requests, paid, issued, revoked, pending: Math.max(0, requests - issued - revoked), issuedByLevel };
}
async function teachers(query) {
  const range = resolvePeriod(query), f = filters(query);
  const teacherWhere = f.teacherId ? { id: f.teacherId } : {};
  const [active, assignments, scheduled, completed, trackedStudents, minutes] = await Promise.all([
    prisma.user.count({ where: { role: 'TEACHER', isActive: true, ...teacherWhere } }),
    prisma.academicTeacherAssignment.count({ where: { removedAt: null, ...(f.teacherId ? { teacherId: f.teacherId } : {}) } }),
    prisma.academicSession.count({ where: { status: 'SCHEDULED', startsAt: range.dateWhere, ...(f.teacherId ? { teacherId: f.teacherId } : {}) } }),
    prisma.academicSession.count({ where: { status: 'COMPLETED', startsAt: range.dateWhere, ...(f.teacherId ? { teacherId: f.teacherId } : {}) } }),
    prisma.academicEnrollment.count({ where: { status: 'ACTIVE', group: { teachers: { some: { removedAt: null, ...(f.teacherId ? { teacherId: f.teacherId } : {}) } } } } }),
    prisma.$queryRaw`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ends_at-starts_at))/60),0)::float AS minutes FROM academic_sessions WHERE status='COMPLETED' AND starts_at BETWEEN ${range.start} AND ${range.end}${f.teacherId ? Prisma.sql` AND teacher_id=${f.teacherId}` : Prisma.empty}`,
  ]);
  return { range, active, assignments, scheduled, completed, trackedStudents, estimatedMinutes: minutes[0]?.minutes || 0 };
}
async function all(query) {
  const [overview, studentReport, academicReport, attendanceReport, evaluationReport, lmsReport, financeReport, certificateReport, teacherReport] = await Promise.all([summary(query), students(query), academic(query), attendance(query), evaluations(query), lms(query), finances(query), certificates(query), teachers(query)]);
  return { overview, studentReport, academicReport, attendanceReport, evaluationReport, lmsReport, financeReport, certificateReport, teacherReport };
}

async function exportRows(type, query) {
  if (!csv.TYPES.includes(type)) throw new ReportFilterError('INVALID_EXPORT', 'Export non autorisé.');
  const range = resolvePeriod(query), take = csv.MAX_EXPORT_ROWS;
  if (type === 'students') {
    const rows = await prisma.user.findMany({ where: { role: 'STUDENT', createdAt: range.dateWhere }, select: { id: true, firstName: true, lastName: true, createdAt: true }, take });
    return { headers: ['ID', 'Prénom', 'Nom', 'Créé le'], rows: rows.map((x) => [x.id, x.firstName, x.lastName, x.createdAt.toISOString()]) };
  }
  if (type === 'enrollments') {
    const rows = await prisma.academicEnrollment.findMany({ where: { enrolledAt: range.dateWhere }, select: { id: true, status: true, entryLevel: true, student: { select: { firstName: true, lastName: true } }, cohort: { select: { name: true, level: true } }, group: { select: { name: true } } }, take });
    return { headers: ['ID', 'Étudiant', 'Niveau', 'Cohorte', 'Groupe', 'Statut'], rows: rows.map((x) => [x.id, `${x.student.firstName} ${x.student.lastName}`, x.entryLevel || x.cohort.level, x.cohort.name, x.group?.name || '', x.status]) };
  }
  if (type === 'attendances') {
    const rows = await prisma.academicAttendance.findMany({ where: { createdAt: range.dateWhere }, select: { status: true, lateMinutes: true, session: { select: { title: true, startsAt: true } }, enrollment: { select: { student: { select: { firstName: true, lastName: true } } } } }, take });
    return { headers: ['Étudiant', 'Séance', 'Date', 'Statut', 'Retard'], rows: rows.map((x) => [`${x.enrollment.student.firstName} ${x.enrollment.student.lastName}`, x.session.title, x.session.startsAt.toISOString(), x.status, x.lateMinutes]) };
  }
  if (type === 'payments') {
    const rows = await prisma.studentPayment.findMany({ where: { paidAt: range.dateWhere }, select: { amount: true, currency: true, method: true, paidAt: true, reference: true, invoice: { select: { number: true, student: { select: { firstName: true, lastName: true } } } } }, take });
    return { headers: ['Facture', 'Étudiant', 'Montant', 'Devise', 'Mode', 'Date', 'Référence'], rows: rows.map((x) => [x.invoice.number, `${x.invoice.student.firstName} ${x.invoice.student.lastName}`, x.amount, x.currency, x.method, x.paidAt.toISOString(), x.reference]) };
  }
  if (type === 'balances') {
    const rows = await prisma.studentInvoice.findMany({ where: { issuedAt: range.dateWhere }, select: { number: true, totalAmount: true, paidAmount: true, balanceAmount: true, currency: true, status: true, student: { select: { firstName: true, lastName: true } } }, take });
    return { headers: ['Facture', 'Étudiant', 'Total', 'Payé', 'Solde', 'Devise', 'Statut'], rows: rows.map((x) => [x.number, `${x.student.firstName} ${x.student.lastName}`, x.totalAmount, x.paidAmount, x.balanceAmount, x.currency, x.status]) };
  }
  if (type === 'certificates') {
    const rows = await prisma.certificate.findMany({ where: { issuedAt: range.dateWhere }, select: { serialNumber: true, studentNameSnapshot: true, courseNameSnapshot: true, status: true, issuedAt: true }, take });
    return { headers: ['Numéro', 'Étudiant', 'Cours', 'Statut', 'Date'], rows: rows.map((x) => [x.serialNumber, x.studentNameSnapshot, x.courseNameSnapshot, x.status, x.issuedAt.toISOString()]) };
  }
  const rows = await prisma.assessmentEvaluation.findMany({ where: { status: 'PUBLISHED', publishedAt: range.dateWhere }, select: { overallScore: true, decision: true, assessment: { select: { title: true, mode: true } }, enrollment: { select: { user: { select: { firstName: true, lastName: true } } } } }, take });
  return { headers: ['Évaluation', 'Type', 'Étudiant', 'Note', 'Décision'], rows: rows.map((x) => [x.assessment.title, x.assessment.mode, `${x.enrollment.user.firstName} ${x.enrollment.user.lastName}`, x.overallScore, x.decision]) };
}
async function exportCsv(type, query, actorId) {
  const data = await exportRows(type, query);
  await prisma.financialAuditLog.create({ data: { actorId, entityType: 'REPORT_EXPORT', entityId: 0, action: type.toUpperCase(), data: { period: query.period || 'THIS_MONTH', rows: data.rows.length } } });
  return csv.encode(data.headers, data.rows);
}

module.exports = { LEVELS, filters, summary, students, academic, attendance, evaluations, lms, finances, certificates, teachers, all, exportRows, exportCsv };
