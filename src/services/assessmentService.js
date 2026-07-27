const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');

async function resolveContext(courseValue, trainingSessionValue, client = prisma) {
  const courseId = validation.parseId(courseValue, 'formation');
  const trainingSessionId = trainingSessionValue
    ? validation.parseId(trainingSessionValue, 'session')
    : null;
  const [course, trainingSession] = await Promise.all([
    client.course.findUnique({ where: { id: courseId }, select: { id: true } }),
    trainingSessionId
      ? client.trainingSession.findUnique({ where: { id: trainingSessionId }, select: { id: true, courseId: true } })
      : null,
  ]);
  if (!course) throw new validation.AssessmentValidationError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  if (trainingSessionId && (!trainingSession || trainingSession.courseId !== course.id)) {
    throw new validation.AssessmentValidationError('SESSION_COURSE_MISMATCH', 'La session n’appartient pas à cette formation.');
  }
  return { courseId, trainingSessionId };
}

async function buildFoundationData(body, createdById, client = prisma) {
  const mode = validation.normalizeMode(body.mode);
  const totalPoints = validation.parseDecimal(body.totalPoints, 'Le total des points', { min: '0.01' });
  const passingScore = validation.parseDecimal(body.passingScore, 'La note de réussite');
  if (passingScore.gt(totalPoints)) {
    throw new validation.AssessmentValidationError('PASSING_SCORE_TOO_HIGH', 'La note de réussite ne peut pas dépasser le total des points.');
  }
  const openAt = validation.parseOptionalDate(body.openAt, 'La date d’ouverture');
  const closeAt = validation.parseOptionalDate(body.closeAt, 'La date de fermeture');
  validation.validateDateRange(openAt, closeAt);
  return {
    ...(await resolveContext(body.courseId, body.trainingSessionId, client)),
    createdById: validation.parseId(createdById, 'créateur'),
    title: validation.requiredText(body.title, 'Le titre', 200),
    description: validation.optionalText(body.description, 'La description', 5000),
    instructions: validation.requiredText(body.instructions, 'Les consignes', 20000),
    mode,
    status: 'DRAFT',
    openAt,
    closeAt,
    totalPoints,
    passingScore,
    preparationSeconds: validation.parseInteger(body.preparationSeconds ?? 0, 'Le temps de préparation', { min: 0, max: 86400 }),
    maxAttempts: validation.parseInteger(body.maxAttempts ?? 1, 'Le nombre de tentatives', { min: 1, max: 100 }),
    maxRecordingSeconds: mode === 'RECORDED_ORAL'
      ? validation.parseInteger(body.maxRecordingSeconds, 'La durée maximale d’enregistrement', { min: 1, max: 14400 })
      : null,
    allowPlayback: body.allowPlayback === undefined
      ? true
      : body.allowPlayback === true || body.allowPlayback === 'true' || body.allowPlayback === 'on',
  };
}

module.exports = { resolveContext, buildFoundationData };
