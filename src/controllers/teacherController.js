const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');
const access = require('../services/teacherAccessService');
const classMeetings = require('../services/classMeetingService');
const attendance = require('../services/attendanceService');
const assignments = require('../services/assignmentService');
const { normalizePhoneNumber } = require('../utils/phone.util');

async function dashboard(req, res) {
  const teacherId = req.teacher.id, now = new Date();
  const [sessions, nextMeetings, studentCount, assignmentCount] = await Promise.all([
    prisma.trainingSession.findMany({ where: { teachers: { some: { teacherId } } }, include: { course: true, _count: { select: { enrollments: true, classMeetings: true } } }, orderBy: { startDate: 'asc' } }),
    prisma.classMeeting.findMany({ where: { trainingSession: { teachers: { some: { teacherId } } }, status: 'SCHEDULED', startsAt: { gte: now } }, include: { trainingSession: { include: { course: true } } }, orderBy: { startsAt: 'asc' }, take: 5 }),
    prisma.enrollment.count({ where: { trainingSession: { teachers: { some: { teacherId } } }, status: { in: ['TRIAL_ACTIVE', 'CONFIRMED'] } } }),
    prisma.assignment.count({ where: { trainingSession: { teachers: { some: { teacherId } } } } }),
  ]);
  res.render('teacher/dashboard', { title: 'Espace enseignant', sessions, nextMeetings, studentCount, assignmentCount });
}
async function sessions(req, res) {
  const items = await prisma.trainingSession.findMany({ where: { teachers: { some: { teacherId: req.teacher.id } } }, include: { course: true, teachers: { include: { teacher: true } }, _count: { select: { enrollments: true } } }, orderBy: { startDate: 'asc' } });
  res.render('teacher/sessions', { title: 'Mes sessions', sessions: items });
}
async function session(req, res) {
  const item = await access.requireSession(req.teacher.id, req.params.id);
  const [meetings, students, courseAssignments] = await Promise.all([
    prisma.classMeeting.findMany({ where: { trainingSessionId: item.id }, include: { lesson: true }, orderBy: { startsAt: 'asc' } }),
    prisma.enrollment.findMany({ where: { trainingSessionId: item.id, status: { in: ['TRIAL_ACTIVE', 'CONFIRMED'] } }, include: { user: { select: { firstName: true, lastName: true } } }, orderBy: { user: { lastName: 'asc' } } }),
    prisma.assignment.findMany({ where: { trainingSessionId: item.id }, include: { _count: { select: { submissions: true } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  res.render('teacher/session', { title: item.name, session: item, meetings, students, assignments: courseAssignments });
}
async function meetingNew(req, res) { const session = await access.requireSession(req.teacher.id, req.params.id); res.render('teacher/meeting-form', { title: 'Nouvelle séance', session, meeting: null, lessons: await classMeetings.listLessonsForSession(session.id), error: null }); }
async function meetingCreate(req, res) { const session = await access.requireSession(req.teacher.id, req.params.id); req.body.trainingSessionId = String(session.id); await classMeetings.create(await classMeetings.buildMeetingData(req.body)); res.redirect(`/teacher/sessions/${session.id}`); }
async function meeting(req, res) { const item = await access.requireMeeting(req.teacher.id, req.params.id); const sheet = await classMeetings.getAttendanceSheet(item.id); res.render('teacher/meeting', { title: item.title || 'Séance', ...sheet }); }
async function saveAttendance(req, res) { const item = await access.requireMeeting(req.teacher.id, req.params.id); const rows = Array.isArray(req.body.rows) ? req.body.rows : Object.values(req.body.rows || {}); await attendance.recordAttendanceBatch(item.id, rows); res.redirect(`/teacher/meetings/${item.id}`); }
async function cancelMeeting(req, res) { const item = await access.requireMeeting(req.teacher.id, req.params.id); await classMeetings.cancel(item.id); res.redirect(`/teacher/sessions/${item.trainingSessionId}`); }
async function createAssignment(req, res) { const session = await access.requireSession(req.teacher.id, req.params.id); req.body.trainingSessionId = String(session.id); await assignments.createAssignment(session.courseId, req.body); res.redirect(`/teacher/sessions/${session.id}`); }
async function submissions(req, res) { const item = await access.requireAssignment(req.teacher.id, req.params.id); const data = await assignments.submissionRows(item.id); res.render('teacher/submissions', { title: item.title, ...data }); }
async function grade(req, res) { await access.requireAssignment(req.teacher.id, req.params.id); await assignments.gradeSubmission(req.params.id, req.params.submissionId, req.body); res.redirect(`/teacher/assignments/${req.params.id}/submissions`); }
async function profile(req, res) { res.render('teacher/profile', { title: 'Mon profil', teacher: req.teacher, error: null, success: req.query.success || '' }); }
async function updateProfile(req, res) {
  const data = { firstName: req.body.firstName?.trim(), lastName: req.body.lastName?.trim(), phoneNumber: normalizePhoneNumber(req.body.phoneNumber) };
  if (!data.firstName || !data.lastName) { const e = new Error('Tous les champs sont obligatoires.'); e.statusCode = 400; throw e; }
  if (req.body.password) {
    if (req.body.password.length < 8 || req.body.password !== req.body.passwordConfirmation) { const e = new Error('Mot de passe invalide ou confirmation différente.'); e.statusCode = 400; throw e; }
    data.passwordHash = await bcrypt.hash(req.body.password, 12);
  }
  await prisma.user.update({ where: { id: req.teacher.id }, data }); res.redirect('/teacher/profile?success=updated');
}
module.exports = { dashboard, sessions, session, meetingNew, meetingCreate, meeting, saveAttendance, cancelMeeting, createAssignment, submissions, grade, profile, updateProfile };
