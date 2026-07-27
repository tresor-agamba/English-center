const prisma = require('../utils/prisma');
const foundation = require('./assessmentService');
const validation = require('./assessmentValidationService');
const management = require('./recordedOralAssessmentService');

function collection(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new validation.AssessmentValidationError('INVALID_COLLECTION', 'La grille fournie est invalide.');
}

async function create(body, actorId) {
  return prisma.$transaction(async tx => {
    const data = await foundation.buildFoundationData({
      ...body,
      mode: 'LIVE_VIDEO_ORAL',
      maxRecordingSeconds: null,
      maxAttempts: 1,
      allowPlayback: false,
    }, actorId, tx);
    await management.requireManager(actorId, data, tx);
    const criteria = validation.validateCriteria(collection(body.criteria), data.totalPoints);
    return tx.assessment.create({
      data: { ...data, criteria: { create: criteria } },
      include: { criteria: { orderBy: { position: 'asc' } }, course: true, trainingSession: true },
    });
  });
}

async function getManaged(value, actorId, client = prisma) {
  const assessment = await client.assessment.findUnique({
    where: { id: validation.parseId(value, 'évaluation') },
    include: {
      course: true,
      trainingSession: true,
      criteria: { orderBy: { position: 'asc' } },
      liveOralSessions: { select: { id: true, status: true } },
    },
  });
  if (!assessment || assessment.mode !== 'LIVE_VIDEO_ORAL') {
    throw new validation.AssessmentValidationError('ASSESSMENT_NOT_FOUND', 'Évaluation en direct introuvable.', 404);
  }
  await management.requireManager(actorId, assessment, client);
  return assessment;
}

async function publish(value, actorId) {
  return prisma.$transaction(async tx => {
    const assessment = await getManaged(value, actorId, tx);
    if (assessment.status === 'PUBLISHED') return assessment;
    validation.validateAssessmentTransition(assessment.status, 'PUBLISHED');
    validation.validateCriteria(assessment.criteria, assessment.totalPoints);
    return tx.assessment.update({
      where: { id: assessment.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { criteria: true, course: true, trainingSession: true },
    });
  });
}

function listForManager(actorId, role) {
  return prisma.assessment.findMany({
    where: {
      mode: 'LIVE_VIDEO_ORAL',
      ...(role === 'TEACHER' ? {
        OR: [
          { trainingSession: { teachers: { some: { teacherId: actorId } } } },
          { trainingSessionId: null, course: { trainingSessions: { some: { teachers: { some: { teacherId: actorId } } } } } },
        ],
      } : {}),
    },
    include: { course: true, trainingSession: true, _count: { select: { liveOralSessions: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = { create, getManaged, publish, listForManager };
