const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const foundation = require('./assessmentService');
const validation = require('./assessmentValidationService');
const notifications = require('./notificationService');

const ACTIVE_ENROLLMENT_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];

async function requireManager(actorId, context, client = prisma) {
  const actor = await client.user.findUnique({
    where: { id: validation.parseId(actorId, 'utilisateur') },
    select: { id: true, role: true, isActive: true },
  });
  if (!actor?.isActive || !['ADMIN', 'TEACHER'].includes(actor.role)) {
    throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Accès interdit.', 403);
  }
  if (actor.role === 'ADMIN') return actor;
  const assignment = await client.trainingSessionTeacher.findFirst({
    where: {
      teacherId: actor.id,
      trainingSession: {
        courseId: context.courseId,
        ...(context.trainingSessionId ? { id: context.trainingSessionId } : {}),
      },
    },
    select: { id: true },
  });
  if (!assignment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Vous n’êtes pas affecté à cette formation.', 403);
  return actor;
}

function normalizeQuestion(input, assessmentMaxAttempts) {
  const type = validation.validateQuestionType('RECORDED_ORAL', input.type);
  return {
    type,
    prompt: validation.requiredText(input.prompt, 'La consigne', 10000),
    preparationSeconds: validation.parseInteger(input.preparationSeconds ?? 0, 'Le temps de préparation', { min: 0, max: 3600 }),
    maxResponseSeconds: validation.parseInteger(input.maxResponseSeconds, 'La durée maximale', { min: 1, max: 14400 }),
    maxAttempts: validation.parseInteger(input.maxAttempts ?? assessmentMaxAttempts, 'Le nombre de remplacements', { min: 1, max: 100 }),
    position: validation.parseInteger(input.position, 'La position', { min: 1, max: 1000 }),
    points: validation.parseDecimal(input.points, 'Les points', { min: '0.01' }),
    isRequired: input.isRequired === undefined || input.isRequired === true || input.isRequired === 'true' || input.isRequired === 'on',
  };
}

function arrayFromBody(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      throw new validation.AssessmentValidationError('INVALID_COLLECTION', 'La liste fournie est invalide.');
    }
  }
  return [];
}

async function create(body, actorId) {
  return prisma.$transaction(async tx => {
    const data = await foundation.buildFoundationData({ ...body, mode: 'RECORDED_ORAL' }, actorId, tx);
    await requireManager(actorId, data, tx);
    const questions = arrayFromBody(body.questions).map(item => normalizeQuestion(item, data.maxAttempts));
    const criteria = body.criteria ? validation.validateCriteria(arrayFromBody(body.criteria), data.totalPoints) : [];
    return tx.assessment.create({
      data: {
        ...data,
        questions: { create: questions },
        criteria: { create: criteria },
      },
      include: { questions: { orderBy: { position: 'asc' } }, criteria: { orderBy: { position: 'asc' } } },
    });
  });
}

async function getManaged(value, actorId, client = prisma) {
  const assessment = await client.assessment.findUnique({
    where: { id: validation.parseId(value, 'évaluation') },
    include: {
      course: true,
      trainingSession: true,
      questions: { orderBy: { position: 'asc' } },
      criteria: { orderBy: { position: 'asc' } },
      _count: { select: { attempts: true } },
    },
  });
  if (!assessment || assessment.mode !== 'RECORDED_ORAL') {
    throw new validation.AssessmentValidationError('ASSESSMENT_NOT_FOUND', 'Évaluation introuvable.', 404);
  }
  await requireManager(actorId, assessment, client);
  return assessment;
}

async function updateDraft(value, body, actorId) {
  return prisma.$transaction(async tx => {
    const existing = await getManaged(value, actorId, tx);
    if (existing.status !== 'DRAFT' || existing._count.attempts > 0) {
      throw new validation.AssessmentValidationError('ASSESSMENT_LOCKED', 'Cette évaluation ne peut plus être modifiée.');
    }
    const data = await foundation.buildFoundationData({ ...body, mode: 'RECORDED_ORAL' }, existing.createdById, tx);
    await requireManager(actorId, data, tx);
    const questions = arrayFromBody(body.questions).map(item => normalizeQuestion(item, data.maxAttempts));
    const criteria = validation.validateCriteria(arrayFromBody(body.criteria), data.totalPoints);
    await tx.assessmentQuestion.deleteMany({ where: { assessmentId: existing.id } });
    await tx.assessmentCriterion.deleteMany({ where: { assessmentId: existing.id } });
    return tx.assessment.update({
      where: { id: existing.id },
      data: {
        ...data,
        createdById: existing.createdById,
        questions: { create: questions },
        criteria: { create: criteria },
      },
      include: { questions: { orderBy: { position: 'asc' } }, criteria: { orderBy: { position: 'asc' } } },
    });
  });
}

async function publish(value, actorId) {
  const result = await prisma.$transaction(async tx => {
    const assessment = await getManaged(value, actorId, tx);
    if (assessment.status === 'PUBLISHED') return { assessment, changed: false };
    validation.validateAssessmentTransition(assessment.status, 'PUBLISHED');
    if (!assessment.questions.length) throw new validation.AssessmentValidationError('QUESTIONS_REQUIRED', 'Ajoutez au moins une question.');
    const questionPoints = assessment.questions.reduce((sum, item) => sum.plus(item.points), new Prisma.Decimal(0));
    if (!questionPoints.equals(assessment.totalPoints)) {
      throw new validation.AssessmentValidationError('QUESTION_POINTS_MISMATCH', 'La somme des points des questions doit correspondre au total.');
    }
    validation.validateCriteria(assessment.criteria, assessment.totalPoints);
    if (assessment.openAt && assessment.closeAt) validation.validateDateRange(assessment.openAt, assessment.closeAt);
    const updated = await tx.assessment.update({
      where: { id: assessment.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { course: true, trainingSession: true },
    });
    return { assessment: updated, changed: true };
  });
  if (result.changed) {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        status: { in: ACTIVE_ENROLLMENT_STATUSES },
        trainingSession: { courseId: result.assessment.courseId },
        ...(result.assessment.trainingSessionId ? { trainingSessionId: result.assessment.trainingSessionId } : {}),
      },
      select: { userId: true },
    });
    await notifications.createNotificationsForUsers(enrollments.map(item => item.userId), {
      type: 'RECORDED_ORAL_PUBLISHED',
      title: 'Nouvelle évaluation orale',
      message: `L’évaluation « ${result.assessment.title} » est disponible.`,
      actionUrl: `/student/oral-assessments/${result.assessment.id}`,
      relatedEntity: 'ASSESSMENT',
      relatedId: result.assessment.id,
    }, `RECORDED_ORAL_PUBLISHED:assessment-${result.assessment.id}`);
  }
  return result.assessment;
}

function listForManager(actorId, role) {
  const where = {
    mode: 'RECORDED_ORAL',
    ...(role === 'TEACHER'
      ? { OR: [
        { trainingSession: { teachers: { some: { teacherId: actorId } } } },
        { trainingSessionId: null, course: { trainingSessions: { some: { teachers: { some: { teacherId: actorId } } } } } },
      ] }
      : {}),
  };
  return prisma.assessment.findMany({
    where,
    include: { course: true, trainingSession: true, _count: { select: { attempts: true, questions: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  ACTIVE_ENROLLMENT_STATUSES,
  requireManager,
  normalizeQuestion,
  create,
  getManaged,
  updateDraft,
  publish,
  listForManager,
};
