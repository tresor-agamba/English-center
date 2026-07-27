const attempts = require('../services/recordedOralAttemptService');
const audioAccess = require('../services/oralAudioAccessService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

async function index(req, res) {
  res.render('student/oral-assessments/index', { title: 'Évaluations orales', items: await attempts.listAvailable(req.student.id) });
}
async function show(req, res) {
  const context = await attempts.eligibleContext(req.student.id, req.params.id);
  res.render('student/oral-assessments/show', { title: context.assessment.title, ...context });
}
async function createAttempt(req, res) {
  const attempt = await attempts.startAttempt(req.student.id, req.params.id);
  res.redirect(`/student/oral-attempts/${attempt.id}`);
}
async function showAttempt(req, res) {
  const attempt = await attempts.requireOwnedAttempt(req.student.id, req.params.id);
  res.render('student/oral-assessments/attempt', { title: attempt.assessment.title, attempt });
}
async function uploadResponse(req, res) {
  await attempts.saveAudioResponse(req.student.id, req.params.id, req.params.questionId, req.file);
  res.redirect(`/student/oral-attempts/${req.params.id}?saved=1`);
}
async function submitAttempt(req, res) {
  await attempts.submit(req.student.id, req.params.id);
  res.redirect('/student/oral-assessments');
}
async function result(req, res) {
  const attempt = await attempts.studentResult(req.student.id, req.params.id);
  res.render('student/oral-assessments/result', { title: 'Résultat', attempt });
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await audioAccess.forStudent(req.student.id, req.params.id));
}

module.exports = { index, show, createAttempt, showAttempt, uploadResponse, submitAttempt, result, audio };
