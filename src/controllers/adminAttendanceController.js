const attendanceService = require('../services/attendanceService');

async function create(req, res) {
  try {
    const result = await attendanceService.recordAttendance({
      enrollmentId: req.body.enrollmentId,
      classMeetingId: req.body.classMeetingId,
      status: req.body.status,
    });
    return res.redirect(`/admin/sessions/${result.trainingSessionId}?attendance=${result.attendance.id}`);
  } catch (error) {
    if (error instanceof attendanceService.AttendanceError) {
      return res.status(error.statusCode || 400).render('error', {
        title: 'Présence invalide',
        message: error.message,
      });
    }
    throw error;
  }
}

module.exports = { create };
