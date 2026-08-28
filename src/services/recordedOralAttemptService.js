const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const audioStorage = require('./oralAudioStorageService');
const notifications = require('./notificationService');
const { ACTIVE_ENROLLMENT_STATUSES } = require('./recordedOralAssessmentService');

async function eligibleContext(studentId, assessmentValue, client = prisma) {
  const assessment = await client.assessment.findUnique({
    where: { id: validation.parseId(assessmentValue, 'évaluation') },
    include: { questions: { orderBy: { position: 'asc' } }, criteria: { orderBy: { position: 'asc' } }, course: true, trainingSession: true },
  });
  if (!assessment || assessment.mode !== 'RECORDED_ORAL' || assessment.status !== 'PUBLISHED') {
    throw new validation.AssessmentValidationError('ASSESSMENT_UNAVAILABLE', 'Cette évaluation n’est pas disponible.', 404);
  }
  const now = new Date();
  if (assessment.openAt && now < assessment.openAt) throw new validation.AssessmentValidationError('ASSESSMENT_NOT_OPEN', 'Cette évaluation n’est pas encore ouverte.', 403);
  if (assessment.closeAt && now > assessment.closeAt) throw new validation.AssessmentValidationError('ASSESSMENT_CLOSED', 'Cette évaluation est fermée.', 403);
  const enrollment = await client.enrollment.findFirst({
    where: {
      userId: validation.parseId(studentId, 'étudiant'),
      status: { in: ACTIVE_ENROLLMENT_STATUSES },
      trainingSession: { courseId: assessment.courseId },
      ...(assessment.trainingSessionId ? { trainingSessionId: assessment.trainingSessionId } : {}),
    },
    select: { id: true, userId: true, trainingSessionId: true, status: true },
  });
  if (!enrollment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Cette évaluation ne vous est pas attribuée.', 403);
  return { assessment, enrollment };
}

async function startAttempt(studentId, assessmentValue) {
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await prisma.$transaction(async tx => {
        const { assessment, enrollment } = await eligibleContext(studentId, assessmentValue, tx);
        const existing = await tx.assessmentAttempt.findFirst({
          where: { assessmentId: assessment.id, enrollmentId: enrollment.id, status: 'DRAFT' },
          orderBy: { attemptNumber: 'desc' },
        });
        if (existing) return existing;
        const aggregate = await tx.assessmentAttempt.aggregate({
          where: { assessmentId: assessment.id, enrollmentId: enrollment.id },
          _max: { attemptNumber: true },
          _count: true,
        });
        if (aggregate._count >= assessment.maxAttempts) {
          throw new validation.AssessmentValidationError('ATTEMPT_LIMIT_REACHED', 'Le nombre maximal de tentatives est atteint.', 403);
        }
        return tx.assessmentAttempt.create({
          data: {
            assessmentId: assessment.id,
            enrollmentId: enrollment.id,
            attemptNumber: (aggregate._max.attemptNumber || 0) + 1,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!['P2002', 'P2034'].includes(error.code) || retry === 2) throw error;
    }
  }
  throw new validation.AssessmentValidationError('ATTEMPT_CONFLICT', 'La tentative n’a pas pu être créée.', 409);
}

async function requireOwnedAttempt(studentId, attemptValue, { draftOnly = false } = {}, client = prisma) {
  const attempt = await client.assessmentAttempt.findFirst({
    where: {
      id: validation.parseId(attemptValue, 'tentative'),
      enrollment: { userId: validation.parseId(studentId, 'étudiant') },
    },
    include: {
      assessment: { include: { course: true, trainingSession: true, questions: { orderBy: { position: 'asc' } }, criteria: { orderBy: { position: 'asc' } } } },
      enrollment: { include: { user: { select: { firstName: true, lastName: true } } } },
      responses: true,
      evaluation: { include: { criterionScores: { orderBy: { assessmentCriterion: { position: 'asc' } } } } },
    },
  });
  if (!attempt || attempt.assessment.mode !== 'RECORDED_ORAL') {
    throw new validation.AssessmentValidationError('ATTEMPT_NOT_FOUND', 'Tentative introuvable.', 404);
  }
  if (draftOnly && attempt.status !== 'DRAFT') throw new validation.AssessmentValidationError('ATTEMPT_LOCKED', 'Cette tentative est verrouillée.', 409);
  return attempt;
}

async function saveAudioResponse(studentId, attemptValue, questionValue, file) {
  let persisted = null;
  try {
    const attempt = await requireOwnedAttempt(studentId, attemptValue, { draftOnly: true });
    await eligibleContext(studentId, attempt.assessmentId);
    const question = attempt.assessment.questions.find(item => item.id === validation.parseId(questionValue, 'question'));
    if (!question) throw new validation.AssessmentValidationError('QUESTION_NOT_FOUND', 'Question introuvable.', 404);
    const inspection = await audioStorage.inspectTemporaryFile(file, question.maxResponseSeconds);
    persisted = await audioStorage.persistTemporaryFile(file, inspection);
    const outcome = await prisma.$transaction(async tx => {
      const currentAttempt = await tx.assessmentAttempt.findUnique({ where: { id: attempt.id }, select: { status: true } });
      if (currentAttempt?.status !== 'DRAFT') throw new validation.AssessmentValidationError('ATTEMPT_LOCKED', 'Cette tentative est verrouillée.', 409);
      const existing = await tx.assessmentResponse.findUnique({
        where: { assessmentAttemptId_assessmentQuestionId: { assessmentAttemptId: attempt.id, assessmentQuestionId: question.id } },
      });
      if (existing && existing.replacementCount >= question.maxAttempts - 1) {
        throw new validation.AssessmentValidationError('REPLACEMENT_LIMIT_REACHED', 'La limite de remplacement de cette réponse est atteinte.', 403);
      }
      const data = {
        audioStorageKey: persisted.storageKey,
        audioOriginalFileName: String(file.originalname || 'recording').slice(0, 255),
        audioMimeType: persisted.mimeType,
        audioSizeBytes: persisted.sizeBytes,
        audioDurationSeconds: persisted.durationSeconds,
        audioChecksum: persisted.checksum,
        recordedAt: new Date(),
      };
      const response = existing
        ? await tx.assessmentResponse.update({ where: { id: existing.id }, data: { ...data, replacementCount: { increment: 1 } } })
        : await tx.assessmentResponse.create({ data: { ...data, assessmentAttemptId: attempt.id, assessmentQuestionId: question.id } });
      return { response, previousStorageKey: existing?.audioStorageKey || null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (outcome.previousStorageKey) await audioStorage.remove(outcome.previousStorageKey);
    return outcome.response;
  } catch (error) {
    if (persisted?.storageKey) await audioStorage.remove(persisted.storageKey).catch(() => {});
    else await audioStorage.removeTemporary(file).catch(() => {});
    throw error;
  }
}

async function submit(studentId, attemptValue) {
  const result = await prisma.$transaction(async tx => {
    const attempt = await requireOwnedAttempt(studentId, attemptValue, { draftOnly: true }, tx);
    await eligibleContext(studentId, attempt.assessmentId, tx);
    const responseByQuestion = new Map(attempt.responses.map(item => [item.assessmentQuestionId, item]));
    const missing = attempt.assessment.questions.filter(question => question.isRequired && !responseByQuestion.get(question.id));
    if (missing.length) throw new validation.AssessmentValidationError('REQUIRED_RESPONSES_MISSING', 'Toutes les questions obligatoires doivent recevoir une réponse.');
    for (const response of attempt.responses) {
      const question = attempt.assessment.questions.find(item => item.id === response.assessmentQuestionId);
      if (!question || !response.audioStorageKey || response.audioDurationSeconds > question.maxResponseSeconds) {
        throw new validation.AssessmentValidationError('INVALID_RESPONSE', 'Une réponse audio est invalide.');
      }
      await audioStorage.verify(response.audioStorageKey, response.audioSizeBytes, response.audioChecksum);
    }
    const updated = await tx.assessmentAttempt.updateMany({
      where: { id: attempt.id, status: 'DRAFT' },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    if (updated.count !== 1) throw new validation.AssessmentValidationError('ATTEMPT_LOCKED', 'Cette tentative est déjà verrouillée.', 409);
    return tx.assessmentAttempt.findUnique({
      where: { id: attempt.id },
      include: { assessment: true, enrollment: true },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const teacherIds = await prisma.trainingSessionTeacher.findMany({
    where: {
      trainingSession: {
        courseId: result.assessment.courseId,
        ...(result.assessment.trainingSessionId ? { id: result.assessment.trainingSessionId } : {}),
      },
    },
    select: { teacherId: true },
  });
  await notifications.createNotificationsForUsers(teacherIds.map(item => item.teacherId), {
    type: 'RECORDED_ORAL_SUBMITTED',
    title: 'Évaluation orale soumise',
    message: `Une nouvelle tentative a été soumise pour « ${result.assessment.title} ».`,
    actionUrl: `/teacher/oral-attempts/${result.id}`,
    relatedEntity: 'ASSESSMENT_ATTEMPT',
    relatedId: result.id,
  }, `RECORDED_ORAL_SUBMITTED:attempt-${result.id}`);
  return result;
}

async function listAvailable(studentId) {
  const now = new Date();
  const enrollments = await prisma.enrollment.findMany({
    where: { userId: validation.parseId(studentId, 'étudiant'), status: { in: ACTIVE_ENROLLMENT_STATUSES } },
    select: { id: true, trainingSessionId: true, trainingSession: { select: { courseId: true } } },
  });
  const courseIds = [...new Set(enrollments.map(item => item.trainingSession.courseId))];
  const sessionIds = enrollments.map(item => item.trainingSessionId);
  if (!courseIds.length) return [];
  return prisma.assessment.findMany({
    where: {
      mode: 'RECORDED_ORAL',
      status: 'PUBLISHED',
      courseId: { in: courseIds },
      OR: [{ trainingSessionId: null }, { trainingSessionId: { in: sessionIds } }],
      AND: [
        { OR: [{ openAt: null }, { openAt: { lte: now } }] },
        { OR: [{ closeAt: null }, { closeAt: { gte: now } }] },
      ],
    },
    include: {
      course: true,
      trainingSession: true,
      attempts: { where: { enrollment: { userId: studentId } }, include: { evaluation: true }, orderBy: { attemptNumber: 'desc' } },
      _count: { select: { questions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function studentResult(studentId, attemptValue) {
  const attempt = await requireOwnedAttempt(studentId, attemptValue);
  if (!attempt.evaluation || attempt.evaluation.status !== 'PUBLISHED') {
    throw new validation.AssessmentValidationError('RESULT_NOT_PUBLISHED', 'Le résultat n’est pas encore publié.', 404);
  }
  return attempt;
}

async function cleanupAbandonedDrafts({ now = new Date(), retentionDays = 30, limit = 100 } = {}) {
  const threshold = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const abandoned = await prisma.assessmentAttempt.findMany({
    where: { status: 'DRAFT', updatedAt: { lt: threshold }, assessment: { mode: 'RECORDED_ORAL' } },
    include: { responses: { select: { audioStorageKey: true } } },
    orderBy: { updatedAt: 'asc' },
    take: Math.min(Math.max(limit, 1), 500),
  });
  let removedAttempts = 0;
  let failedFiles = 0;
  for (const attempt of abandoned) {
    const deleted = await prisma.assessmentAttempt.deleteMany({ where: { id: attempt.id, status: 'DRAFT', updatedAt: { lt: threshold } } });
    if (!deleted.count) continue;
    removedAttempts += 1;
    for (const response of attempt.responses) {
      try { await audioStorage.remove(response.audioStorageKey); } catch {
        failedFiles += 1;
        console.error('Nettoyage audio oral impossible : fichier privé orphelin.');
      }
    }
  }
  const removedTemporaryFiles = await audioStorage.cleanupTemporaryFiles();
  return { removedAttempts, removedTemporaryFiles, failedFiles };
}

module.exports = {
  eligibleContext,
  startAttempt,
  requireOwnedAttempt,
  saveAudioResponse,
  submit,
  listAvailable,
  studentResult,
  cleanupAbandonedDrafts,
};
