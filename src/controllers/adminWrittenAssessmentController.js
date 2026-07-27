const prisma = require('../utils/prisma');
const assessments = require('../services/writtenAssessmentService');
const evaluations = require('../services/writtenEvaluationService');
const media = require('../services/writtenMediaService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

const actor = req => req.session.user.id;
async function options() {
  return Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.trainingSession.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, courseId: true } }),
  ]);
}
async function index(req, res) {
  res.render('admin/written-assessments/index', { title: 'Évaluations écrites', items: await assessments.listForManager(actor(req), 'ADMIN') });
}
async function newForm(req, res) {
  const [courses, sessions] = await options();
  res.render('admin/written-assessments/form', { title: 'Nouvelle évaluation écrite', courses, sessions });
}
async function create(req, res) {
  const item = await assessments.create(req.body, actor(req));
  res.redirect(`/admin/written-assessments/${item.id}`);
}
async function edit(req, res) {
  const [courses, sessions] = await options();
  const item = await assessments.getManaged(req.params.id, actor(req));
  res.render('admin/written-assessments/form', { title: 'Modifier l’évaluation écrite', courses, sessions, item });
}
async function update(req, res) {
  await assessments.updateDraft(req.params.id, req.body, actor(req));
  res.redirect(`/admin/written-assessments/${req.params.id}`);
}
async function show(req, res) {
  const item = await assessments.getManaged(req.params.id, actor(req));
  const attempts = await evaluations.attemptsFor(actor(req), item.id);
  res.render('admin/written-assessments/show', { title: item.title, item, attempts });
}
async function publish(req, res) {
  await assessments.publish(req.params.id, actor(req));
  res.redirect(`/admin/written-assessments/${req.params.id}`);
}
async function close(req, res) {
  await assessments.close(req.params.id, actor(req));
  res.redirect(`/admin/written-assessments/${req.params.id}`);
}
async function uploadAudio(req, res) {
  const result = await media.upload(actor(req), req.params.questionId, req.file);
  res.redirect(`/admin/written-assessments/${req.params.id}?audio=${result.questionId}`);
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await media.forStaff(actor(req), req.params.questionId));
}
async function attempt(req, res) {
  const item = await evaluations.requireAttempt(actor(req), req.params.id);
  res.render('teacher/written-assessments/attempt', { title: 'Correction écrite', item, base: '/admin/written-assessments/attempts', evaluationBase: '/admin/written-assessments/evaluations' });
}
async function grade(req, res) {
  await evaluations.grade(actor(req), req.params.id, req.body);
  res.redirect(`/admin/written-assessments/attempts/${req.params.id}`);
}
async function publishEvaluation(req, res) {
  const item = await evaluations.publish(actor(req), req.params.id);
  res.redirect(`/admin/written-assessments/attempts/${item.assessmentAttemptId}`);
}

module.exports = { index, newForm, create, edit, update, show, publish, close, uploadAudio, audio, attempt, grade, publishEvaluation };
