const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const written = require('./writtenAssessmentService');
const notifications = require('./notificationService');

const ACTIVE_ENROLLMENTS = ['TRIAL_ACTIVE', 'CONFIRMED'];

function nowState(assessment, now = new Date()) {
  if (assessment.status !== 'PUBLISHED') throw new validation.AssessmentValidationError('ASSESSMENT_UNAVAILABLE', 'Cette évaluation n’est pas disponible.', 403);
  if (assessment.openAt && now < assessment.openAt) throw new validation.AssessmentValidationError('ASSESSMENT_NOT_OPEN', 'Cette évaluation n’est pas encore ouverte.', 403);
  if (assessment.closeAt && now > assessment.closeAt) throw new validation.AssessmentValidationError('ASSESSMENT_CLOSED', 'Cette évaluation est fermée.', 403);
}

async function enrollmentFor(studentId, assessment, client = prisma) {
  const enrollment = await client.enrollment.findFirst({
    where: {
      userId: validation.parseId(studentId, 'étudiant'),
      trainingSession: { courseId: assessment.courseId },
      ...(assessment.trainingSessionId ? { trainingSessionId: assessment.trainingSessionId } : {}),
      status: { in: ACTIVE_ENROLLMENTS },
    },
    orderBy: { enrolledAt: 'desc' },
  });
  if (!enrollment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Évaluation inaccessible.', 403);
  return enrollment;
}

function safeQuestion(question, includeExplanation = false) {
  return {
    id: question.id, type: question.type, prompt: question.prompt, options: question.options,
    mediaStorageKey: question.mediaStorageKey ? 'available' : null,
    position: question.position, points: question.points, isRequired: question.isRequired,
    parentQuestionId: question.parentQuestionId,
    ...(includeExplanation ? { explanation: question.explanation } : {}),
  };
}

async function listAvailable(studentId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: validation.parseId(studentId, 'étudiant'), status: { in: ACTIVE_ENROLLMENTS } },
    select: { id: true, trainingSessionId: true, trainingSession: { select: { courseId: true } } },
  });
  const courseIds = [...new Set(enrollments.map(item => item.trainingSession.courseId))];
  const sessionIds = enrollments.map(item => item.trainingSessionId);
  return prisma.assessment.findMany({
    where: {
      mode: 'WRITTEN', status: 'PUBLISHED',
      courseId: { in: courseIds },
      OR: [{ trainingSessionId: null }, { trainingSessionId: { in: sessionIds } }],
    },
    select: {
      id: true, title: true, description: true, openAt: true, closeAt: true,
      timeLimitMinutes: true, maxAttempts: true, totalPoints: true,
      course: { select: { title: true } },
      attempts: {
        where: { enrollment: { userId: studentId } },
        select: { id: true, status: true, attemptNumber: true, expiresAt: true },
        orderBy: { attemptNumber: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function context(studentId, assessmentValue, now = new Date()) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: validation.parseId(assessmentValue, 'évaluation') },
    include: { questions: { orderBy: { position: 'asc' } } },
  });
  if (!assessment || assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('ASSESSMENT_NOT_FOUND', 'Évaluation introuvable.', 404);
  nowState(assessment, now);
  const enrollment = await enrollmentFor(studentId, assessment);
  const attempts = await prisma.assessmentAttempt.findMany({
    where: { assessmentId: assessment.id, enrollmentId: enrollment.id },
    orderBy: { attemptNumber: 'desc' },
  });
  return { assessment: { ...assessment, questions: assessment.questions.map(item => safeQuestion(item)) }, enrollment, attempts };
}

async function start(studentId, assessmentValue, now = new Date()) {
  for (let retry = 0; retry < 6; retry += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const assessment = await tx.assessment.findUnique({ where: { id: validation.parseId(assessmentValue, 'évaluation') } });
        if (!assessment || assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('ASSESSMENT_NOT_FOUND', 'Évaluation introuvable.', 404);
        nowState(assessment, now);
        const enrollment = await enrollmentFor(studentId, assessment, tx);
        const existing = await tx.assessmentAttempt.findFirst({
          where: { assessmentId: assessment.id, enrollmentId: enrollment.id, status: 'DRAFT' },
          orderBy: { attemptNumber: 'desc' },
        });
        if (existing) return existing;
        const count = await tx.assessmentAttempt.count({ where: { assessmentId: assessment.id, enrollmentId: enrollment.id } });
        if (count >= assessment.maxAttempts) throw new validation.AssessmentValidationError('ATTEMPT_LIMIT_REACHED', 'Le nombre de tentatives autorisées est atteint.');
        return tx.assessmentAttempt.create({
          data: {
            assessmentId: assessment.id, enrollmentId: enrollment.id, attemptNumber: count + 1, startedAt: now,
            expiresAt: assessment.timeLimitMinutes ? new Date(now.getTime() + assessment.timeLimitMinutes * 60000) : null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error.code === 'P2002') {
        const assessmentId = validation.parseId(assessmentValue, 'évaluation');
        const existing = await prisma.assessmentAttempt.findFirst({
          where: { assessmentId, enrollment: { userId: validation.parseId(studentId, 'étudiant') }, status: 'DRAFT' },
          orderBy: { attemptNumber: 'desc' },
        });
        if (existing) return existing;
      }
      if (error.code !== 'P2034' || retry === 5) throw error;
      await new Promise(resolve => setTimeout(resolve, 15 * (retry + 1)));
    }
  }
  throw new validation.AssessmentValidationError('ATTEMPT_CONFLICT', 'La tentative n’a pas pu être créée.', 409);
}

async function requireOwned(studentId, attemptValue, client = prisma) {
  const attempt = await client.assessmentAttempt.findFirst({
    where: { id: validation.parseId(attemptValue, 'tentative'), enrollment: { userId: validation.parseId(studentId, 'étudiant') } },
    include: {
      assessment: { include: { questions: { orderBy: { position: 'asc' } }, course: true } },
      responses: true,
      evaluation: { include: { criterionScores: true } },
    },
  });
  if (!attempt || attempt.assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('ATTEMPT_NOT_FOUND', 'Tentative introuvable.', 404);
  return attempt;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((acc, key) => ({ ...acc, [key]: canonical(value[key]) }), {});
  if (typeof value === 'boolean') return String(value);
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('fr') : value;
}
function autoScore(question, answer) {
  if (!written.AUTO_TYPES.includes(question.type)) return null;
  let actual = canonical(answer);
  let expected = canonical(question.expectedAnswer);
  if (question.type === 'MULTIPLE_SELECT') {
    actual = Array.isArray(actual) ? [...actual].sort() : actual;
    expected = Array.isArray(expected) ? [...expected].sort() : expected;
  }
  return JSON.stringify(actual) === JSON.stringify(expected) ? new Prisma.Decimal(question.points) : new Prisma.Decimal(0);
}

async function saveResponse(studentId, attemptValue, questionValue, body, now = new Date()) {
  const current = await requireOwned(studentId, attemptValue);
  if (current.status === 'DRAFT' && current.expiresAt && now >= current.expiresAt) {
    await submit(studentId, current.id, now);
    throw new validation.AssessmentValidationError('TIME_LIMIT_EXCEEDED', 'Le temps est écoulé et la tentative a été soumise.', 409);
  }
  return prisma.$transaction(async tx => {
    const attempt = await requireOwned(studentId, attemptValue, tx);
    if (attempt.status !== 'DRAFT') throw new validation.AssessmentValidationError('ATTEMPT_LOCKED', 'Cette tentative est verrouillée.', 409);
    if (attempt.expiresAt && now >= attempt.expiresAt) throw new validation.AssessmentValidationError('TIME_LIMIT_EXCEEDED', 'Le temps est écoulé.', 409);
    const question = attempt.assessment.questions.find(item => item.id === validation.parseId(questionValue, 'question'));
    if (!question || written.CONTAINER_TYPES.includes(question.type)) throw new validation.AssessmentValidationError('QUESTION_NOT_FOUND', 'Question introuvable.', 404);
    let selectedOptions = body.selectedOptions !== undefined ? body.selectedOptions : null;
    if (selectedOptions !== null && ['MATCHING', 'ORDERING'].includes(question.type) && typeof selectedOptions === 'string') {
      try { selectedOptions = JSON.parse(selectedOptions); } catch {
        throw new validation.AssessmentValidationError('INVALID_ANSWER', 'La réponse structurée est invalide.');
      }
    }
    const textResponse = body.textResponse !== undefined ? validation.optionalText(body.textResponse, 'La réponse', 50000) : null;
    const answer = selectedOptions !== null ? selectedOptions : textResponse;
    const awardedPoints = autoScore(question, answer);
    return tx.assessmentResponse.upsert({
      where: { assessmentAttemptId_assessmentQuestionId: { assessmentAttemptId: attempt.id, assessmentQuestionId: question.id } },
      create: {
        assessmentAttemptId: attempt.id, assessmentQuestionId: question.id, textResponse, selectedOptions,
        awardedPoints, isAutoGraded: awardedPoints !== null,
      },
      update: { textResponse, selectedOptions, awardedPoints, isAutoGraded: awardedPoints !== null, gradingFeedback: null },
    });
  });
}

async function submitInTransaction(tx, attempt, now, automatic) {
  if (attempt.status !== 'DRAFT') return attempt;
  const requiredIds = attempt.assessment.questions.filter(q => q.isRequired && !written.CONTAINER_TYPES.includes(q.type)).map(q => q.id);
  const answered = new Set(attempt.responses.filter(r => r.textResponse !== null || r.selectedOptions !== null).map(r => r.assessmentQuestionId));
  if (!automatic && requiredIds.some(id => !answered.has(id))) {
    throw new validation.AssessmentValidationError('REQUIRED_RESPONSES_MISSING', 'Toutes les questions obligatoires doivent recevoir une réponse.');
  }
  const updated = await tx.assessmentAttempt.update({
    where: { id: attempt.id },
    data: { status: 'SUBMITTED', submittedAt: now, ...(automatic ? { autoSubmittedAt: now } : {}) },
  });
  const manualCount = attempt.assessment.questions.filter(q => written.MANUAL_TYPES.includes(q.type)).length;
  if (manualCount === 0) {
    const total = attempt.responses.reduce((sum, row) => sum.plus(row.awardedPoints || 0), new Prisma.Decimal(0));
    await tx.assessmentEvaluation.create({
      data: {
        assessmentId: attempt.assessmentId, enrollmentId: attempt.enrollmentId, assessmentAttemptId: attempt.id,
        evaluatorId: attempt.assessment.createdById, overallScore: total,
        decision: total.gte(attempt.assessment.passingScore) ? 'PASSED' : 'FAILED', gradedAt: now,
      },
    });
    await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: 'GRADED', gradedAt: now } });
  }
  return updated;
}

async function submit(studentId, attemptValue, now = new Date()) {
  const result = await prisma.$transaction(async tx => {
    const attempt = await requireOwned(studentId, attemptValue, tx);
    return { attempt: await submitInTransaction(tx, attempt, now, Boolean(attempt.expiresAt && now >= attempt.expiresAt)), assessment: attempt.assessment };
  });
  await notifications.createNotification({
    userId: result.assessment.createdById, type: 'WRITTEN_ATTEMPT_SUBMITTED',
    title: 'Tentative écrite soumise', message: `Une tentative pour « ${result.assessment.title} » a été soumise.`,
    actionUrl: '/notifications',
    relatedEntity: 'ASSESSMENT_ATTEMPT', relatedId: result.attempt.id,
    deduplicationKey: `WRITTEN_ATTEMPT_SUBMITTED:attempt-${result.attempt.id}`,
  });
  return result.attempt;
}

async function studentAttempt(studentId, value, now = new Date()) {
  const attempt = await requireOwned(studentId, value);
  if (attempt.status === 'DRAFT' && attempt.expiresAt && now >= attempt.expiresAt) {
    await submit(studentId, attempt.id, now);
    return requireOwned(studentId, attempt.id);
  }
  return {
    ...attempt,
    assessment: { ...attempt.assessment, questions: attempt.assessment.questions.map(item => safeQuestion(item)) },
  };
}

async function result(studentId, value) {
  const attempt = await requireOwned(studentId, value);
  if (attempt.evaluation?.status !== 'PUBLISHED') throw new validation.AssessmentValidationError('RESULT_NOT_PUBLISHED', 'Le résultat n’est pas encore publié.', 403);
  return {
    ...attempt,
    assessment: {
      ...attempt.assessment,
      questions: attempt.assessment.questions.map(item => safeQuestion(item, true)),
    },
  };
}

module.exports = { ACTIVE_ENROLLMENTS, nowState, safeQuestion, listAvailable, context, start, requireOwned, canonical, autoScore, saveResponse, submit, studentAttempt, result };
