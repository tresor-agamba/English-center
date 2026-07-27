const prisma = require('../utils/prisma');
const service = require('../services/academicService');

async function adminDashboard(req, res) {
  const [cohorts, groups, enrollments, assignments, sessions] = await Promise.all([
    prisma.academicCohort.findMany({ include: { level: true, course: true }, orderBy: { startDate: 'desc' }, take: 100 }),
    prisma.academicGroup.findMany({ include: { cohort: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.academicEnrollment.findMany({ include: { student: true, cohort: true, group: true }, orderBy: { enrolledAt: 'desc' }, take: 100 }),
    prisma.academicTeacherAssignment.findMany({ where: { removedAt: null }, include: { teacher: true, cohort: true, group: true }, take: 100 }),
    prisma.academicSession.findMany({ include: { group: true, teacher: true }, orderBy: { startsAt: 'desc' }, take: 100 }),
  ]);
  res.render('admin/academic/index', { title: 'Gestion académique', levels: service.ACADEMIC_LEVELS, cohorts, groups, enrollments, assignments, sessions });
}
const redirectAdmin = (res) => res.redirect('/admin/academic');
async function createCohort(req, res) { await service.createCohort(req.body); redirectAdmin(res); }
async function createGroup(req, res) { await service.createGroup(req.body); redirectAdmin(res); }
async function enroll(req, res) { await service.enrollStudent(req.body, req.session.user.id); redirectAdmin(res); }
async function enrollmentStatus(req, res) { await service.changeEnrollmentStatus(req.params.id, req.body.status, req.session.user.id); redirectAdmin(res); }
async function transfer(req, res) { await service.transfer(req.params.id, req.body.groupId, req.body.reason, req.session.user.id); redirectAdmin(res); }
async function assign(req, res) { await service.assignTeacher(req.body, req.session.user.id); redirectAdmin(res); }
async function createSession(req, res) { await service.createSession(req.body, req.session.user.id); redirectAdmin(res); }
async function sessionStatus(req, res) { await service.changeSessionStatus(req.params.id, req.body.status, req.body.reason, req.session.user.id); redirectAdmin(res); }
async function attendance(req, res) { await service.recordAttendance(req.body, req.session.user.id); redirectAdmin(res); }

async function teacherDashboard(req, res) {
  const assignments = await service.teacherOverview(req.teacher.id);
  res.render('teacher/academic/index', { title: 'Mes groupes académiques', assignments });
}
async function teacherCreateSession(req, res) {
  await service.createSession({ ...req.body, teacherId: req.teacher.id }, req.teacher.id, true);
  res.redirect('/teacher/academic');
}
async function teacherAttendance(req, res) {
  await service.recordAttendance(req.body, req.teacher.id, true);
  res.redirect('/teacher/academic');
}
async function studentDashboard(req, res) {
  const enrollments = await service.studentOverview(req.student.id);
  res.render('student/academic/index', { title: 'Mon parcours académique', enrollments });
}

module.exports = {
  adminDashboard, createCohort, createGroup, enroll, enrollmentStatus, transfer,
  assign, createSession, sessionStatus, attendance, teacherDashboard, teacherCreateSession,
  teacherAttendance, studentDashboard,
};
