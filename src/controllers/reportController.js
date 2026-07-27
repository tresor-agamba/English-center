const prisma = require('../utils/prisma');
const reports = require('../services/reportService');
const { PERIODS } = require('../services/reportPeriodService');
const csv = require('../services/reportCsvService');

async function filterOptions() {
  const [cohorts, groups, teachers] = await Promise.all([
    prisma.academicCohort.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.academicGroup.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ where: { role: 'TEACHER', isActive: true }, select: { id: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' } }),
  ]);
  return { cohorts, groups, teachers };
}
async function admin(req, res) {
  const [data, options] = await Promise.all([reports.all(req.query), filterOptions()]);
  res.render('admin/reports/index', { title: 'Rapports', ...data, ...options, periods: PERIODS, query: req.query, exportTypes: csv.TYPES });
}
async function exportReport(req, res) {
  const output = await reports.exportCsv(req.params.type, req.query, req.session.user.id);
  res.type('text/csv; charset=utf-8').setHeader('Content-Disposition', `attachment; filename="rapport-${req.params.type}.csv"`);
  res.send(output);
}
async function teacher(req, res) {
  const query = { ...req.query, teacherId: String(req.teacher.id) };
  const [academicReport, attendanceReport, evaluationReport, teacherReport] = await Promise.all([
    reports.academic(query), reports.attendance(query), reports.evaluations(query), reports.teachers(query),
  ]);
  res.render('teacher/reports/index', { title: 'Mes rapports', academicReport, attendanceReport, evaluationReport, teacherReport, periods: PERIODS, query: req.query });
}
module.exports = { admin, exportReport, teacher };
