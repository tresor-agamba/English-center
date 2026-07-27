const prisma = require('../utils/prisma');
const assessments = require('../services/liveOralAssessmentService');
const sessions = require('../services/liveOralSessionService');

const actorId = req => req.session.user.id;

async function options() {
  return Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.trainingSession.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        course: { select: { title: true } },
        enrollments: {
          where: { status: { in: sessions.PARTICIPANT_STATUSES } },
          select: { id: true, user: { select: { firstName: true, lastName: true } } },
        },
        teachers: { select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
      },
    }),
    prisma.assessment.findMany({
      where: { mode: 'LIVE_VIDEO_ORAL', status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, courseId: true, trainingSessionId: true },
    }),
  ]);
}

async function assessmentIndex(req, res) {
  res.render('admin/live-oral-assessments/index', { title: 'Évaluations orales en direct', items: await assessments.listForManager(actorId(req), 'ADMIN') });
}
async function assessmentNew(req, res) {
  const [courses, trainingSessions] = await options();
  res.render('admin/live-oral-assessments/form', { title: 'Nouvel oral en direct', courses, sessions: trainingSessions });
}
async function assessmentCreate(req, res) {
  const item = await assessments.create(req.body, actorId(req));
  res.redirect(`/admin/live-oral-assessments/${item.id}`);
}
async function assessmentShow(req, res) {
  const item = await assessments.getManaged(req.params.id, actorId(req));
  res.render('admin/live-oral-assessments/show', { title: item.title, item });
}
async function assessmentPublish(req, res) {
  await assessments.publish(req.params.id, actorId(req));
  res.redirect(`/admin/live-oral-assessments/${req.params.id}`);
}
async function sessionIndex(req, res) {
  res.render('admin/live-oral-sessions/index', { title: 'Sessions orales en direct', items: await sessions.listForAdmin() });
}
async function sessionNew(req, res) {
  const [, trainingSessions, liveAssessments] = await options();
  res.render('admin/live-oral-sessions/form', { title: 'Planifier une session orale', trainingSessions, assessments: liveAssessments, item: null });
}
async function sessionCreate(req, res) {
  const item = await sessions.create(req.body, actorId(req));
  res.redirect(`/admin/live-oral-sessions/${item.id}`);
}
async function sessionShow(req, res) {
  const item = await sessions.getAdminDetail(req.params.id, actorId(req));
  res.render('admin/live-oral-sessions/show', { title: item.assessment.title, item });
}
async function cancel(req, res) {
  await sessions.cancel(req.params.id, actorId(req), req.body.reason);
  res.redirect(`/admin/live-oral-sessions/${req.params.id}`);
}
async function reschedule(req, res) {
  const item = await sessions.reschedule(req.params.id, actorId(req), req.body);
  res.redirect(`/admin/live-oral-sessions/${item.id}`);
}

module.exports = {
  assessmentIndex, assessmentNew, assessmentCreate, assessmentShow, assessmentPublish,
  sessionIndex, sessionNew, sessionCreate, sessionShow, cancel, reschedule,
};
