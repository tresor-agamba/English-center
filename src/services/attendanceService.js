const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');

const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'];

class AttendanceError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AttendanceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AttendanceError('INVALID_ID', `${label} invalide.`);
  return id;
}

async function recordAttendance({ enrollmentId: rawEnrollmentId, classMeetingId: rawMeetingId, status }) {
  const enrollmentId = parseId(rawEnrollmentId, 'Inscription');
  const classMeetingId = parseId(rawMeetingId, 'Séance');
  if (!ATTENDANCE_STATUSES.includes(status)) {
    throw new AttendanceError('INVALID_STATUS', 'Statut de présence invalide.');
  }

  return prisma.$transaction(async (tx) => {
    const [enrollment, meeting] = await Promise.all([
      tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { id: true, trainingSessionId: true } }),
      tx.classMeeting.findUnique({ where: { id: classMeetingId }, select: { id: true, trainingSessionId: true } }),
    ]);
    if (!enrollment) throw new AttendanceError('ENROLLMENT_NOT_FOUND', 'Inscription introuvable.', 404);
    if (!meeting) throw new AttendanceError('MEETING_NOT_FOUND', 'Séance introuvable.', 404);
    if (enrollment.trainingSessionId !== meeting.trainingSessionId) {
      throw new AttendanceError('SESSION_MISMATCH', 'Cette séance ne correspond pas à l’inscription.');
    }

    const attendance = await tx.attendance.upsert({
      where: { enrollmentId_classMeetingId: { enrollmentId, classMeetingId } },
      create: { enrollmentId, classMeetingId, status },
      update: { status },
      select: { id: true, enrollmentId: true, classMeetingId: true, status: true },
    });
    const trialAccess = await trialAccessService.calculateTrialAccess(enrollmentId, tx);
    return { attendance, trialAccess, trainingSessionId: meeting.trainingSessionId };
  });
}

module.exports = { ATTENDANCE_STATUSES, AttendanceError, recordAttendance };
