const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const management = require('./writtenAssessmentService');
const attempts = require('./writtenAttemptService');
const storage = require('./oralAudioStorageService');

async function upload(actorId, questionValue, file) {
  let persisted;
  try {
    const question = await prisma.assessmentQuestion.findUnique({
      where: { id: validation.parseId(questionValue, 'question') },
      include: { assessment: true },
    });
    if (!question || !['LISTENING', 'LISTENING_COMPREHENSION'].includes(question.type)) {
      throw new validation.AssessmentValidationError('QUESTION_NOT_FOUND', 'Question Listening introuvable.', 404);
    }
    await management.getManaged(question.assessmentId, actorId);
    if (question.assessment.status !== 'DRAFT') throw new validation.AssessmentValidationError('ASSESSMENT_LOCKED', 'Une évaluation publiée ne peut plus être modifiée.', 409);
    const inspection = await storage.inspectTemporaryFile(file, 7200);
    persisted = await storage.persistTemporaryFile(file, inspection);
    await prisma.assessmentQuestion.update({
      where: { id: question.id },
      data: { mediaStorageKey: persisted.storageKey, mediaMimeType: persisted.mimeType },
    });
    await storage.remove(question.mediaStorageKey);
    return { questionId: question.id, mimeType: persisted.mimeType };
  } catch (error) {
    if (!persisted) await storage.removeTemporary(file).catch(() => {});
    throw error;
  }
}

async function forStudent(studentId, attemptValue, questionValue) {
  const attempt = await attempts.requireOwned(studentId, attemptValue);
  const question = attempt.assessment.questions.find(item => item.id === validation.parseId(questionValue, 'question'));
  if (!question?.mediaStorageKey || !['LISTENING', 'LISTENING_COMPREHENSION'].includes(question.type)) {
    throw new validation.AssessmentValidationError('AUDIO_NOT_FOUND', 'Audio inaccessible.', 404);
  }
  const file = await storage.stat(question.mediaStorageKey);
  return { ...file, mimeType: question.mediaMimeType };
}

async function forStaff(actorId, questionValue) {
  const question = await prisma.assessmentQuestion.findUnique({
    where: { id: validation.parseId(questionValue, 'question') },
    include: { assessment: true },
  });
  if (!question?.mediaStorageKey) throw new validation.AssessmentValidationError('AUDIO_NOT_FOUND', 'Audio inaccessible.', 404);
  await management.getManaged(question.assessmentId, actorId);
  const file = await storage.stat(question.mediaStorageKey);
  return { ...file, mimeType: question.mediaMimeType };
}

module.exports = { upload, forStudent, forStaff };
