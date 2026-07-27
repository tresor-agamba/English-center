const access = require('../services/liveOralAccessService');
const sessions = require('../services/liveOralSessionService');
const evaluations = require('../services/liveOralEvaluationService');
const prisma = require('../utils/prisma');

async function index(req, res) {
  res.render('teacher/live-oral-sessions/index', { title: 'Oraux en direct', items: await access.teacherList(req.teacher.id) });
}
async function newForm(req, res) {
  const trainingSessions = await prisma.trainingSession.findMany({
    where: { teachers: { some: { teacherId: req.teacher.id } } },
    include: {
      course: { select: { title: true } },
      enrollments: {
        where: { status: { in: sessions.PARTICIPANT_STATUSES } },
        select: { id: true, user: { select: { firstName: true, lastName: true } } },
      },
      teachers: { select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
    },
  });
  const assessments = await prisma.assessment.findMany({
    where: {
      mode: 'LIVE_VIDEO_ORAL', status: 'PUBLISHED',
      OR: [
        { trainingSession: { teachers: { some: { teacherId: req.teacher.id } } } },
        { trainingSessionId: null, course: { trainingSessions: { some: { teachers: { some: { teacherId: req.teacher.id } } } } } },
      ],
    },
    select: { id: true, title: true },
  });
  res.render('teacher/live-oral-sessions/form', { title: 'Planifier un oral', trainingSessions, assessments });
}
async function create(req, res) {
  const item = await sessions.create(req.body, req.teacher.id);
  res.redirect(`/teacher/live-oral-sessions/${item.id}`);
}
async function show(req, res) {
  const item = await access.requireExaminer(req.teacher.id, req.params.id);
  res.render('teacher/live-oral-sessions/show', { title: item.assessment.title, item });
}
async function join(req, res) {
  res.redirect(await access.teacherJoin(req.teacher.id, req.params.id));
}
async function start(req, res) {
  await access.transition(req.teacher.id, req.params.id, 'IN_PROGRESS');
  res.redirect(`/teacher/live-oral-sessions/${req.params.id}`);
}
async function complete(req, res) {
  await access.transition(req.teacher.id, req.params.id, 'COMPLETED');
  res.redirect(`/teacher/live-oral-sessions/${req.params.id}`);
}
async function attendance(req, res) {
  await access.recordAttendance(req.teacher.id, req.params.id, req.body);
  res.redirect(`/teacher/live-oral-sessions/${req.params.id}`);
}
async function grade(req, res) {
  await evaluations.saveDraft(req.teacher.id, req.params.id, req.params.enrollmentId || req.body.enrollmentId, req.body);
  res.redirect(`/teacher/live-oral-sessions/${req.params.id}`);
}
async function publishEvaluation(req, res) {
  const evaluation = await evaluations.publish(req.teacher.id, req.params.id);
  res.redirect(`/teacher/live-oral-sessions/${evaluation.liveOralSessionId}`);
}
async function reschedule(req, res) {
  const item = await sessions.reschedule(req.params.id, req.teacher.id, req.body);
  res.redirect(`/teacher/live-oral-sessions/${item.id}`);
}
async function cancel(req, res) {
  await sessions.cancel(req.params.id, req.teacher.id, req.body.reason);
  res.redirect('/teacher/live-oral-sessions');
}

module.exports = { index, newForm, create, show, join, start, complete, attendance, grade, publishEvaluation, reschedule, cancel };
