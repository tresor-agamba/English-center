const access = require('../services/assignmentAccessService');
const { AssignmentError } = require('../services/assignmentService');

function errorPage(error, res) {
  if (error instanceof AssignmentError) {
    return res.status(error.statusCode).render('student/enrollment/unavailable', {
      title: 'Devoir indisponible', message: error.message,
    });
  }
  throw error;
}

async function index(req, res) {
  const assignments = await access.listAll(req.student.id);
  res.render('student/assignments/index', { title: 'Mes devoirs', assignments, stats: access.overview(assignments) });
}

async function courseAssignments(req, res) {
  try {
    const data = await access.listForEnrollment(req.student.id, req.params.enrollmentId);
    const assignments = data.assignments.map((item) => ({ ...item, enrollmentId: data.enrollment.id, course: data.course, fullAccess: data.fullAccess }));
    return res.render('student/assignments/index', { title: `Devoirs — ${data.course.title}`, assignments, stats: access.overview(assignments) });
  } catch (error) {
    return errorPage(error, res);
  }
}

async function show(req, res) {
  try {
    const data = await access.getForStudent(req.student.id, req.params.enrollmentId, req.params.assignmentId);
    return res.render('student/assignments/show', { title: data.assignment.title, ...data, error: null });
  } catch (error) {
    return errorPage(error, res);
  }
}

async function submit(req, res) {
  try {
    await access.submit(req.student.id, req.params.enrollmentId, req.params.assignmentId, req.body);
    return res.redirect(`/student/courses/${req.params.enrollmentId}/assignments/${req.params.assignmentId}`);
  } catch (error) {
    if (!(error instanceof AssignmentError)) throw error;
    try {
      const data = await access.getForStudent(req.student.id, req.params.enrollmentId, req.params.assignmentId);
      return res.status(error.statusCode).render('student/assignments/show', { title: data.assignment.title, ...data, error: error.message });
    } catch {
      return errorPage(error, res);
    }
  }
}

module.exports = { index, courseAssignments, show, submit };
