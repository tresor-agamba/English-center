const access = require('../services/liveOralAccessService');

async function index(req, res) {
  res.render('student/live-oral-sessions/index', { title: 'Mes oraux en direct', items: await access.studentList(req.student.id) });
}
async function show(req, res) {
  const item = await access.studentDetail(req.student.id, req.params.id);
  res.render('student/live-oral-sessions/show', { title: item.assessment.title, item });
}
async function join(req, res) {
  res.redirect(await access.studentJoin(req.student.id, req.params.id));
}

module.exports = { index, show, join };
