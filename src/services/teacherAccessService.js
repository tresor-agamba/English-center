const prisma = require('../utils/prisma');

class TeacherAccessError extends Error {
  constructor(message = 'Ressource inaccessible.', statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
    this.code = 'TEACHER_ACCESS_DENIED';
  }
}

function parseId(value, label = 'ressource') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new TeacherAccessError(`Identifiant de ${label} invalide.`, 400);
  return id;
}

async function requireSession(teacherId, value) {
  const assignment = await prisma.trainingSessionTeacher.findUnique({
    where: { trainingSessionId_teacherId: { trainingSessionId: parseId(value, 'session'), teacherId } },
    include: { trainingSession: { include: { course: true } } },
  });
  if (!assignment) throw new TeacherAccessError();
  return assignment.trainingSession;
}

async function requireMeeting(teacherId, value) {
  const meeting = await prisma.classMeeting.findFirst({
    where: { id: parseId(value, 'séance'), trainingSession: { teachers: { some: { teacherId } } } },
    include: { trainingSession: { include: { course: true } }, lesson: true, _count: { select: { attendances: true } } },
  });
  if (!meeting) throw new TeacherAccessError();
  return meeting;
}

async function requireAssignment(teacherId, value) {
  const assignment = await prisma.assignment.findFirst({
    where: { id: parseId(value, 'devoir'), trainingSession: { teachers: { some: { teacherId } } } },
    include: { trainingSession: { include: { course: true } } },
  });
  if (!assignment) throw new TeacherAccessError();
  return assignment;
}

module.exports = { TeacherAccessError, parseId, requireSession, requireMeeting, requireAssignment };
