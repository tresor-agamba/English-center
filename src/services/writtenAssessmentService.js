const prisma = require('../utils/prisma');
const foundation = require('./assessmentService');
const validation = require('./assessmentValidationService');
const management = require('./recordedOralAssessmentService');
const notifications = require('./notificationService');

const AUTO_TYPES = ['MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE', 'FILL_IN_THE_BLANK', 'MATCHING', 'ORDERING'];
const MANUAL_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'ESSAY', 'READING_COMPREHENSION', 'LISTENING_COMPREHENSION'];
const CONTAINER_TYPES = ['LISTENING', 'READING'];

function collection(value, label = 'questions') {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new validation.AssessmentValidationError('INVALID_COLLECTION', `Les ${label} sont invalides.`);
}

function safeJson(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new validation.AssessmentValidationError('INVALID_JSON', `${label} est invalide.`);
  }
  try { JSON.stringify(value); return value; } catch {
    throw new validation.AssessmentValidationError('INVALID_JSON', `${label} est invalide.`);
  }
}

function normalizeQuestions(value, totalPoints) {
  const positions = new Set();
  let points = new (require('@prisma/client').Prisma.Decimal)(0);
  const rows = collection(value).map((item, index) => {
    const type = validation.validateQuestionType('WRITTEN', item.type);
    const position = validation.parseInteger(item.position ?? index + 1, 'La position', { min: 1, max: 1000 });
    if (positions.has(position)) throw new validation.AssessmentValidationError('DUPLICATE_QUESTION_POSITION', 'Les positions doivent être uniques.');
    positions.add(position);
    const questionPoints = validation.parseDecimal(item.points ?? 0, 'Les points', { min: CONTAINER_TYPES.includes(type) ? '0' : '0.01' });
    points = points.plus(questionPoints);
    const options = safeJson(item.options, 'Les options');
    const expectedAnswer = safeJson(item.expectedAnswer, 'La bonne réponse');
    if (AUTO_TYPES.includes(type) && expectedAnswer === null) {
      throw new validation.AssessmentValidationError('EXPECTED_ANSWER_REQUIRED', 'Une bonne réponse est requise pour cette question.');
    }
    if (['MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'MATCHING', 'ORDERING'].includes(type) && !options) {
      throw new validation.AssessmentValidationError('OPTIONS_REQUIRED', 'Les options sont obligatoires pour cette question.');
    }
    if (!AUTO_TYPES.includes(type) && expectedAnswer !== null) {
      throw new validation.AssessmentValidationError('EXPECTED_ANSWER_FORBIDDEN', 'Une question manuelle ou conteneur ne doit pas définir de bonne réponse.');
    }
    return {
      type,
      prompt: validation.requiredText(item.prompt, `La question ${index + 1}`, 20000),
      options,
      expectedAnswer,
      explanation: validation.optionalText(item.explanation, 'L’explication', 10000),
      position,
      points: questionPoints,
      isRequired: item.isRequired !== false && item.isRequired !== 'false',
      parentPosition: item.parentPosition ? validation.parseInteger(item.parentPosition, 'La question parente', { min: 1, max: 1000 }) : null,
      mediaStorageKey: item.mediaStorageKey || null,
      mediaMimeType: item.mediaMimeType || null,
    };
  });
  if (!rows.length) throw new validation.AssessmentValidationError('QUESTIONS_REQUIRED', 'Au moins une question est requise.');
  if (!points.equals(totalPoints)) throw new validation.AssessmentValidationError('INVALID_QUESTION_POINTS', 'La somme des points doit correspondre au total.');
  for (const row of rows) {
    if (row.parentPosition) {
      const parent = rows.find(item => item.position === row.parentPosition);
      if (!parent || !CONTAINER_TYPES.includes(parent.type)) {
        throw new validation.AssessmentValidationError('INVALID_PARENT_QUESTION', 'La question parente doit être de type Listening ou Reading.');
      }
    }
  }
  return rows;
}

async function create(body, actorId) {
  return prisma.$transaction(async tx => {
    const data = await foundation.buildFoundationData({ ...body, mode: 'WRITTEN', maxRecordingSeconds: null, allowPlayback: false }, actorId, tx);
    await management.requireManager(actorId, data, tx);
    data.timeLimitMinutes = validation.parseInteger(body.timeLimitMinutes, 'La durée', { min: 1, max: 1440, nullable: true });
    const rows = normalizeQuestions(body.questions, data.totalPoints);
    const assessment = await tx.assessment.create({ data });
    const byPosition = new Map();
    for (const row of rows.sort((a, b) => a.position - b.position)) {
      const { parentPosition, ...questionData } = row;
      if (parentPosition && !byPosition.get(parentPosition)) {
        throw new validation.AssessmentValidationError('INVALID_PARENT_ORDER', 'La question parente doit précéder ses sous-questions.');
      }
      const created = await tx.assessmentQuestion.create({
        data: { ...questionData, assessmentId: assessment.id, parentQuestionId: parentPosition ? byPosition.get(parentPosition) : null },
      });
      byPosition.set(row.position, created.id);
    }
    return getManaged(assessment.id, actorId, tx);
  });
}

async function updateDraft(value, body, actorId) {
  return prisma.$transaction(async tx => {
    const current = await getManaged(value, actorId, tx);
    if (current.status !== 'DRAFT' || current._count.attempts > 0) {
      throw new validation.AssessmentValidationError('ASSESSMENT_LOCKED', 'Cette évaluation ne peut plus être modifiée.', 409);
    }
    const data = await foundation.buildFoundationData({ ...body, mode: 'WRITTEN', maxRecordingSeconds: null, allowPlayback: false }, actorId, tx);
    await management.requireManager(actorId, data, tx);
    data.timeLimitMinutes = validation.parseInteger(body.timeLimitMinutes, 'La durée', { min: 1, max: 1440, nullable: true });
    const rows = normalizeQuestions(body.questions, data.totalPoints);
    await tx.assessmentQuestion.deleteMany({ where: { assessmentId: current.id } });
    await tx.assessment.update({
      where: { id: current.id },
      data: { ...data, createdById: current.createdById, status: 'DRAFT' },
    });
    const byPosition = new Map();
    for (const row of rows.sort((a, b) => a.position - b.position)) {
      const { parentPosition, ...questionData } = row;
      const parentQuestionId = parentPosition ? byPosition.get(parentPosition) : null;
      if (parentPosition && !parentQuestionId) throw new validation.AssessmentValidationError('INVALID_PARENT_ORDER', 'La question parente doit précéder ses sous-questions.');
      const created = await tx.assessmentQuestion.create({ data: { ...questionData, assessmentId: current.id, parentQuestionId } });
      byPosition.set(row.position, created.id);
    }
    return getManaged(current.id, actorId, tx);
  });
}

async function getManaged(value, actorId, client = prisma) {
  const assessment = await client.assessment.findUnique({
    where: { id: validation.parseId(value, 'évaluation') },
    include: {
      course: true, trainingSession: true,
      questions: { orderBy: { position: 'asc' } },
      _count: { select: { attempts: true } },
    },
  });
  if (!assessment || assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('ASSESSMENT_NOT_FOUND', 'Évaluation écrite introuvable.', 404);
  await management.requireManager(actorId, assessment, client);
  return assessment;
}

async function publish(value, actorId) {
  const result = await prisma.$transaction(async tx => {
    const assessment = await getManaged(value, actorId, tx);
    if (assessment.status === 'PUBLISHED') return { assessment, changed: false };
    validation.validateAssessmentTransition(assessment.status, 'PUBLISHED');
    normalizeQuestions(assessment.questions, assessment.totalPoints);
    const updated = await tx.assessment.update({ where: { id: assessment.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    return { assessment: updated, changed: true };
  });
  if (result.changed) {
    const enrollments = await prisma.enrollment.findMany({
      where: {
        trainingSession: { courseId: result.assessment.courseId },
        ...(result.assessment.trainingSessionId ? { trainingSessionId: result.assessment.trainingSessionId } : {}),
        status: { in: ['TRIAL_ACTIVE', 'CONFIRMED'] },
      },
      select: { userId: true },
    });
    await notifications.createNotificationsForUsers(enrollments.map(item => item.userId), {
      type: 'WRITTEN_ASSESSMENT_PUBLISHED', title: 'Évaluation écrite publiée',
      message: `L’évaluation « ${result.assessment.title} » est disponible.`,
      actionUrl: `/student/written-assessments/${result.assessment.id}`,
      relatedEntity: 'ASSESSMENT', relatedId: result.assessment.id,
    }, `WRITTEN_ASSESSMENT_PUBLISHED:assessment-${result.assessment.id}`);
  }
  return result.assessment;
}

async function close(value, actorId) {
  return prisma.$transaction(async tx => {
    const assessment = await getManaged(value, actorId, tx);
    if (assessment.status === 'CLOSED') return assessment;
    validation.validateAssessmentTransition(assessment.status, 'CLOSED');
    return tx.assessment.update({ where: { id: assessment.id }, data: { status: 'CLOSED', closedAt: new Date() } });
  });
}

function listForManager(actorId, role) {
  return prisma.assessment.findMany({
    where: {
      mode: 'WRITTEN',
      ...(role === 'TEACHER' ? {
        OR: [
          { trainingSession: { teachers: { some: { teacherId: actorId } } } },
          { trainingSessionId: null, course: { trainingSessions: { some: { teachers: { some: { teacherId: actorId } } } } } },
        ],
      } : {}),
    },
    include: { course: true, trainingSession: true, _count: { select: { questions: true, attempts: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = { AUTO_TYPES, MANUAL_TYPES, CONTAINER_TYPES, collection, normalizeQuestions, create, updateDraft, getManaged, publish, close, listForManager };
