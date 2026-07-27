const attempts = require('../services/writtenAttemptService');
const media = require('../services/writtenMediaService');
const sendPrivateAudio = require('./helpers/sendPrivateAudio');

async function index(req, res) {
  res.render('student/written-assessments/index', { title: 'Évaluations écrites', items: await attempts.listAvailable(req.student.id) });
}
async function show(req, res) {
  const context = await attempts.context(req.student.id, req.params.id);
  res.render('student/written-assessments/show', { title: context.assessment.title, ...context });
}
async function start(req, res) {
  const attempt = await attempts.start(req.student.id, req.params.id);
  res.redirect(`/student/written-attempts/${attempt.id}`);
}
async function attempt(req, res) {
  const item = await attempts.studentAttempt(req.student.id, req.params.id);
  res.render('student/written-assessments/attempt', { title: item.assessment.title, item });
}
async function save(req, res) {
  const response = await attempts.saveResponse(req.student.id, req.params.id, req.params.questionId, req.body);
  if (req.get('accept')?.includes('application/json')) return res.json({ saved: true, responseId: response.id });
  return res.redirect(`/student/written-attempts/${req.params.id}`);
}
async function submit(req, res) {
  await attempts.submit(req.student.id, req.params.id);
  res.redirect('/student/written-assessments');
}
async function result(req, res) {
  const item = await attempts.result(req.student.id, req.params.id);
  res.render('student/written-assessments/result', { title: 'Résultat écrit', item });
}
async function audio(req, res) {
  return sendPrivateAudio(req, res, await media.forStudent(req.student.id, req.params.id, req.params.questionId));
}

module.exports = { index, show, start, attempt, save, submit, result, audio };
