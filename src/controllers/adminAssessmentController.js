const prisma = require('../utils/prisma');
const assessments = require('../services/recordedOralAssessmentService');
const evaluations = require('../services/recordedOralEvaluationService');
const audioAccess = require('../services/oralAudioAccessService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

async function formOptions() {
  return Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } }),
    prisma.trainingSession.findMany({ orderBy: { startDate: 'desc' }, select: { id: true, name: true, courseId: true } }),
  ]);
}
async function index(req, res) {
  res.render('admin/oral-assessments/index', {
    title: 'Évaluations orales', items: await assessments.listForManager(req.session.user.id, 'ADMIN'),
  });
}
async function newForm(req, res) {
  const [courses, sessions] = await formOptions();
  res.render('admin/oral-assessments/form', { title: 'Nouvelle évaluation orale', assessment: null, courses, sessions });
}
async function create(req, res) {
  const item = await assessments.create(req.body, req.session.user.id);
  res.redirect(`/admin/oral-assessments/${item.id}`);
}
async function show(req, res) {
  const assessment = await assessments.getManaged(req.params.id, req.session.user.id);
  const submissions = await evaluations.submissionRows(req.session.user.id, assessment.id);
  res.render('admin/oral-assessments/show', { title: assessment.title, assessment, submissions });
}
async function edit(req, res) {
  const assessment = await assessments.getManaged(req.params.id, req.session.user.id);
  const [courses, sessions] = await formOptions();
  res.render('admin/oral-assessments/form', { title: 'Modifier l’évaluation', assessment, courses, sessions });
}
async function update(req, res) {
  await assessments.updateDraft(req.params.id, req.body, req.session.user.id);
  res.redirect(`/admin/oral-assessments/${req.params.id}`);
}
async function publish(req, res) {
  await assessments.publish(req.params.id, req.session.user.id);
  res.redirect(`/admin/oral-assessments/${req.params.id}`);
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await audioAccess.forStaff(req.session.user.id, req.params.id));
}

module.exports = { index, newForm, create, show, edit, update, publish, audio };
