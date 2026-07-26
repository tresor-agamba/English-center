const service = require('../services/assignmentService');

function renderError(error, res, view, data) {
  if (error instanceof service.AssignmentError) return res.status(error.statusCode).render(view, { ...data, error: error.message });
  throw error;
}

async function index(req, res) {
  const course = await service.courseAssignments(req.params.courseId);
  res.render('admin/assignments/index', { title: `Devoirs — ${course.title}`, course });
}

async function newForm(req, res) {
  const course = await service.courseAssignments(req.params.courseId);
  res.render('admin/assignments/new', { title: 'Nouveau devoir', course, form: {}, error: null });
}

async function create(req, res) {
  try {
    const assignment = await service.createAssignment(req.params.courseId, req.body);
    return res.redirect(`/admin/assignments/${assignment.id}`);
  } catch (error) {
    const course = await service.courseAssignments(req.params.courseId);
    return renderError(error, res, 'admin/assignments/new', { title: 'Nouveau devoir', course, form: req.body });
  }
}

async function show(req, res) {
  const assignment = await service.getAssignment(req.params.id);
  res.render('admin/assignments/show', { title: assignment.title, assignment });
}

async function editForm(req, res) {
  const assignment = await service.getAssignment(req.params.id);
  const course = await service.courseAssignments(assignment.courseId);
  res.render('admin/assignments/edit', { title: `Modifier ${assignment.title}`, assignment, course, form: assignment, error: null });
}

async function update(req, res) {
  const assignment = await service.getAssignment(req.params.id);
  try {
    await service.updateAssignment(assignment.id, req.body);
    return res.redirect(`/admin/assignments/${assignment.id}`);
  } catch (error) {
    const course = await service.courseAssignments(assignment.courseId);
    return renderError(error, res, 'admin/assignments/edit', { title: `Modifier ${assignment.title}`, assignment, course, form: req.body });
  }
}

async function toggle(req, res) {
  const assignment = await service.togglePublished(req.params.id);
  res.redirect(`/admin/assignments/${assignment.id}`);
}

async function remove(req, res) {
  const result = await service.deleteAssignment(req.params.id);
  res.redirect(`/admin/courses/${result.courseId}/assignments`);
}

async function submissions(req, res) {
  const data = await service.submissionRows(req.params.id);
  const filter = ['missing', 'submitted', 'late', 'graded', 'returned'].includes(req.query.filter) ? req.query.filter : 'all';
  const rows = data.rows.filter((row) => {
    if (filter === 'missing') return !row.submission;
    if (!row.submission) return filter === 'all';
    if (filter === 'submitted') return ['SUBMITTED', 'LATE'].includes(row.submission.status);
    if (filter === 'late') return row.submission.status === 'LATE';
    if (filter === 'graded') return ['GRADED', 'RETURNED'].includes(row.submission.status);
    if (filter === 'returned') return row.submission.status === 'RETURNED';
    return true;
  });
  res.render('admin/assignments/submissions', {
    title: `Soumissions — ${data.assignment.title}`, assignment: data.assignment, rows,
    filter, stats: service.calculateStatistics(data.rows, data.assignment.maxScore),
  });
}

async function submission(req, res) {
  const data = await service.getSubmission(req.params.assignmentId, req.params.submissionId);
  res.render('admin/assignments/submission-detail', { title: `Correction — ${data.assignment.title}`, ...data, error: null });
}

async function grade(req, res) {
  try {
    await service.gradeSubmission(req.params.assignmentId, req.params.submissionId, req.body);
    return res.redirect(`/admin/assignments/${req.params.assignmentId}/submissions/${req.params.submissionId}`);
  } catch (error) {
    const data = await service.getSubmission(req.params.assignmentId, req.params.submissionId);
    return renderError(error, res, 'admin/assignments/submission-detail', { title: `Correction — ${data.assignment.title}`, ...data });
  }
}

async function publish(req, res, published) {
  await service.setFeedbackPublished(req.params.assignmentId, req.params.submissionId, published);
  res.redirect(`/admin/assignments/${req.params.assignmentId}/submissions/${req.params.submissionId}`);
}

module.exports = {
  index, newForm, create, show, editForm, update, toggle, remove, submissions, submission, grade,
  publishFeedback: (req, res) => publish(req, res, true),
  unpublishFeedback: (req, res) => publish(req, res, false),
};
