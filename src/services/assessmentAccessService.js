const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');

async function requireStudentEnrollment(studentId, enrollmentValue, client = prisma) {
  const enrollment = await client.enrollment.findFirst({
    where: {
      id: validation.parseId(enrollmentValue, 'inscription'),
      userId: validation.parseId(studentId, 'étudiant'),
    },
    select: { id: true, userId: true, trainingSessionId: true, status: true },
  });
  if (!enrollment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Ressource inaccessible.', 403);
  return enrollment;
}

async function requireAssignedExaminer(teacherId, liveSessionValue, client = prisma) {
  const assignment = await client.liveOralExaminer.findUnique({
    where: {
      liveOralSessionId_teacherId: {
        liveOralSessionId: validation.parseId(liveSessionValue, 'session orale'),
        teacherId: validation.parseId(teacherId, 'enseignant'),
      },
    },
    select: { id: true, role: true, liveOralSessionId: true, teacherId: true },
  });
  if (!assignment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Ressource inaccessible.', 403);
  return assignment;
}

module.exports = { requireStudentEnrollment, requireAssignedExaminer };
