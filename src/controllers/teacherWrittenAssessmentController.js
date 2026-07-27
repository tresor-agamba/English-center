const prisma = require('../utils/prisma');
const assessments = require('../services/writtenAssessmentService');
const evaluations = require('../services/writtenEvaluationService');
const media = require('../services/writtenMediaService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

async function options(teacherId) {
  const sessions = await prisma.trainingSession.findMany({
    where: { teachers: { some: { teacherId } } },
    include: { course: { select: { id: true, title: true } } },
    orderBy: { startDate: 'desc' },
  });
  return { sessions, courses: [...new Map(sessions.map(row => [row.course.id, row.course])).values()] };
}
async function index(req, res) {
  res.render('teacher/written-assessments/index', { title: 'Évaluations écrites', items: await assessments.listForManager(req.teacher.id, 'TEACHER') });
}
async function newForm(req, res) {
  res.render('teacher/written-assessments/form', { title: 'Nouvelle évaluation écrite', ...(await options(req.teacher.id)) });
}
async function create(req, res) {
  const item = await assessments.create(req.body, req.teacher.id);
  res.redirect(`/teacher/written-assessments/${item.id}`);
}
async function edit(req, res) {
  const item = await assessments.getManaged(req.params.id, req.teacher.id);
  res.render('teacher/written-assessments/form', { title: 'Modifier l’évaluation écrite', item, ...(await options(req.teacher.id)) });
}
async function update(req, res) {
  await assessments.updateDraft(req.params.id, req.body, req.teacher.id);
  res.redirect(`/teacher/written-assessments/${req.params.id}`);
}
async function show(req, res) {
  const item = await assessments.getManaged(req.params.id, req.teacher.id);
  const attempts = await evaluations.attemptsFor(req.teacher.id, item.id);
  res.render('teacher/written-assessments/show', { title: item.title, item, attempts });
}
async function publish(req, res) {
  await assessments.publish(req.params.id, req.teacher.id);
  res.redirect(`/teacher/written-assessments/${req.params.id}`);
}
async function close(req, res) {
  await assessments.close(req.params.id, req.teacher.id);
  res.redirect(`/teacher/written-assessments/${req.params.id}`);
}
async function attempt(req, res) {
  const item = await evaluations.requireAttempt(req.teacher.id, req.params.id);
  res.render('teacher/written-assessments/attempt', { title: 'Correction écrite', item, base: '/teacher/written-attempts', evaluationBase: '/teacher/written-evaluations' });
}
async function grade(req, res) {
  await evaluations.grade(req.teacher.id, req.params.id, req.body);
  res.redirect(`/teacher/written-attempts/${req.params.id}`);
}
async function publishEvaluation(req, res) {
  const item = await evaluations.publish(req.teacher.id, req.params.id);
  res.redirect(`/teacher/written-attempts/${item.assessmentAttemptId}`);
}
async function uploadAudio(req, res) {
  await media.upload(req.teacher.id, req.params.questionId, req.file);
  res.redirect(`/teacher/written-assessments/${req.params.id}`);
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await media.forStaff(req.teacher.id, req.params.questionId));
}

module.exports = { index, newForm, create, edit, update, show, publish, close, attempt, grade, publishEvaluation, uploadAudio, audio };
