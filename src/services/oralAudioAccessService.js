const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const management = require('./recordedOralAssessmentService');
const storage = require('./oralAudioStorageService');

const responseInclude = {
  assessmentAttempt: {
    include: {
      assessment: { include: { course: true, trainingSession: true } },
      enrollment: true,
    },
  },
};

async function getResponse(value) {
  const response = await prisma.assessmentResponse.findUnique({
    where: { id: validation.parseId(value, 'réponse') },
    include: responseInclude,
  });
  if (!response?.audioStorageKey) throw new validation.AssessmentValidationError('AUDIO_NOT_FOUND', 'Fichier audio inaccessible.', 404);
  return response;
}

async function forStudent(studentId, responseValue) {
  const response = await getResponse(responseValue);
  if (response.assessmentAttempt.enrollment.userId !== validation.parseId(studentId, 'étudiant')
      || !response.assessmentAttempt.assessment.allowPlayback) {
    throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Fichier audio inaccessible.', 403);
  }
  return { response, file: await storage.stat(response.audioStorageKey) };
}

async function forStaff(actorId, responseValue) {
  const response = await getResponse(responseValue);
  await management.requireManager(actorId, response.assessmentAttempt.assessment);
  return { response, file: await storage.stat(response.audioStorageKey) };
}

module.exports = { getResponse, forStudent, forStaff };
