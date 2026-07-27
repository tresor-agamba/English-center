const prisma = require('../utils/prisma');
const assessments = require('../services/recordedOralAssessmentService');
const evaluations = require('../services/recordedOralEvaluationService');
const liveEvaluations = require('../services/liveOralEvaluationService');
const audioAccess = require('../services/oralAudioAccessService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

async function formOptions(teacherId) {
  const sessions = await prisma.trainingSession.findMany({
    where: { teachers: { some: { teacherId } } },
    include: { course: { select: { id: true, title: true } } },
    orderBy: { startDate: 'desc' },
  });
  const courses = [...new Map(sessions.map(item => [item.course.id, item.course])).values()];
  return { courses, sessions };
}
async function index(req, res) {
  res.render('teacher/oral-assessments/index', {
    title: 'Évaluations orales',
    items: await assessments.listForManager(req.teacher.id, 'TEACHER'),
  });
}
async function newForm(req, res) {
  res.render('teacher/oral-assessments/form', { title: 'Nouvelle évaluation orale', assessment: null, ...(await formOptions(req.teacher.id)) });
}
async function create(req, res) {
  const item = await assessments.create(req.body, req.teacher.id);
  res.redirect(`/teacher/oral-assessments/${item.id}`);
}
async function show(req, res) {
  const assessment = await assessments.getManaged(req.params.id, req.teacher.id);
  const submissions = await evaluations.submissionRows(req.teacher.id, assessment.id);
  res.render('teacher/oral-assessments/show', { title: assessment.title, assessment, submissions });
}
async function edit(req, res) {
  const assessment = await assessments.getManaged(req.params.id, req.teacher.id);
  res.render('teacher/oral-assessments/form', { title: 'Modifier l’évaluation', assessment, ...(await formOptions(req.teacher.id)) });
}
async function update(req, res) {
  await assessments.updateDraft(req.params.id, req.body, req.teacher.id);
  res.redirect(`/teacher/oral-assessments/${req.params.id}`);
}
async function publish(req, res) {
  await assessments.publish(req.params.id, req.teacher.id);
  res.redirect(`/teacher/oral-assessments/${req.params.id}`);
}
async function attempt(req, res) {
  const item = await evaluations.requireAttempt(req.teacher.id, req.params.id);
  res.render('teacher/oral-assessments/attempt', { title: 'Correction orale', attempt: item });
}
async function gradeAttempt(req, res) {
  const evaluation = await evaluations.saveDraft(req.teacher.id, req.params.id, req.body);
  res.redirect(`/teacher/oral-attempts/${req.params.id}?saved=${evaluation.id}`);
}
async function publishEvaluation(req, res) {
  const source = await prisma.assessmentEvaluation.findUnique({
    where: { id: Number(req.params.id) },
    select: { liveOralSessionId: true },
  });
  if (source?.liveOralSessionId) {
    const evaluation = await liveEvaluations.publish(req.teacher.id, req.params.id);
    return res.redirect(`/teacher/live-oral-sessions/${evaluation.liveOralSessionId}`);
  }
  const evaluation = await evaluations.publish(req.teacher.id, req.params.id);
  return res.redirect(`/teacher/oral-attempts/${evaluation.assessmentAttemptId}`);
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await audioAccess.forStaff(req.teacher.id, req.params.id));
}

module.exports = { index, newForm, create, show, edit, update, publish, attempt, gradeAttempt, publishEvaluation, audio };
