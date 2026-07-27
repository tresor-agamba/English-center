const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const management = require('./recordedOralAssessmentService');
const written = require('./writtenAssessmentService');
const notifications = require('./notificationService');

async function requireAttempt(actorId, value, client = prisma) {
  const attempt = await client.assessmentAttempt.findUnique({
    where: { id: validation.parseId(value, 'tentative') },
    include: {
      assessment: { include: { questions: { orderBy: { position: 'asc' } }, course: true, trainingSession: true } },
      enrollment: { include: { user: { select: { firstName: true, lastName: true } } } },
      responses: { include: { assessmentQuestion: true } },
      evaluation: true,
    },
  });
  if (!attempt || attempt.assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('ATTEMPT_NOT_FOUND', 'Tentative introuvable.', 404);
  await management.requireManager(actorId, attempt.assessment, client);
  return attempt;
}

function scoreCollection(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {}
  }
  throw new validation.AssessmentValidationError('INVALID_SCORES', 'Les notes manuelles sont invalides.');
}

async function grade(actorId, attemptValue, body) {
  return prisma.$transaction(async tx => {
    const attempt = await requireAttempt(actorId, attemptValue, tx);
    if (attempt.evaluation?.status === 'PUBLISHED') throw new validation.AssessmentValidationError('EVALUATION_LOCKED', 'Le résultat publié est verrouillé.', 409);
    if (!['SUBMITTED', 'GRADED'].includes(attempt.status)) throw new validation.AssessmentValidationError('ATTEMPT_NOT_SUBMITTED', 'La tentative doit être soumise.');
    const manualQuestions = attempt.assessment.questions.filter(q => written.MANUAL_TYPES.includes(q.type));
    const scores = scoreCollection(body.scores);
    if (scores.length !== manualQuestions.length) throw new validation.AssessmentValidationError('INCOMPLETE_SCORES', 'Toutes les réponses manuelles doivent être notées.');
    const byQuestion = new Map(scores.map(item => [validation.parseId(item.questionId, 'question'), item]));
    for (const question of manualQuestions) {
      const row = byQuestion.get(question.id);
      if (!row) throw new validation.AssessmentValidationError('INCOMPLETE_SCORES', 'Toutes les réponses manuelles doivent être notées.');
      const response = attempt.responses.find(item => item.assessmentQuestionId === question.id);
      if (!response) throw new validation.AssessmentValidationError('RESPONSE_NOT_FOUND', 'Réponse manuelle introuvable.');
      const score = validation.parseDecimal(row.score, 'La note');
      if (score.gt(question.points)) throw new validation.AssessmentValidationError('SCORE_TOO_HIGH', 'Une note dépasse le maximum de la question.');
      await tx.assessmentResponse.update({
        where: { id: response.id },
        data: { awardedPoints: score, isAutoGraded: false, gradingFeedback: validation.optionalText(row.feedback, 'Le commentaire', 5000) },
      });
    }
    const allResponses = await tx.assessmentResponse.findMany({ where: { assessmentAttemptId: attempt.id } });
    const total = allResponses.reduce((sum, row) => sum.plus(row.awardedPoints || 0), new Prisma.Decimal(0));
    const data = {
      assessmentId: attempt.assessmentId, enrollmentId: attempt.enrollmentId, assessmentAttemptId: attempt.id,
      evaluatorId: validation.parseId(actorId, 'évaluateur'), overallScore: total,
      feedback: validation.optionalText(body.feedback, 'Le feedback', 20000),
      strengths: validation.optionalText(body.strengths, 'Les points forts', 10000),
      improvements: validation.optionalText(body.improvements, 'Les axes d’amélioration', 10000),
      decision: total.gte(attempt.assessment.passingScore) ? 'PASSED' : 'FAILED',
      status: 'DRAFT', gradedAt: new Date(),
    };
    const evaluation = attempt.evaluation
      ? await tx.assessmentEvaluation.update({ where: { id: attempt.evaluation.id }, data })
      : await tx.assessmentEvaluation.create({ data });
    await tx.assessmentAttempt.update({ where: { id: attempt.id }, data: { status: 'GRADED', gradedAt: new Date() } });
    return evaluation;
  });
}

async function publish(actorId, evaluationValue) {
  const result = await prisma.$transaction(async tx => {
    const evaluation = await tx.assessmentEvaluation.findUnique({
      where: { id: validation.parseId(evaluationValue, 'évaluation') },
      include: { assessment: true, assessmentAttempt: true, enrollment: true },
    });
    if (!evaluation?.assessmentAttempt || evaluation.assessment.mode !== 'WRITTEN') throw new validation.AssessmentValidationError('EVALUATION_NOT_FOUND', 'Résultat introuvable.', 404);
    await requireAttempt(actorId, evaluation.assessmentAttemptId, tx);
    if (evaluation.status === 'PUBLISHED') return { evaluation, changed: false };
    if (!evaluation.gradedAt) throw new validation.AssessmentValidationError('EVALUATION_INCOMPLETE', 'La correction est incomplète.');
    const updated = await tx.assessmentEvaluation.update({
      where: { id: evaluation.id }, data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { assessment: true, enrollment: true },
    });
    await tx.assessmentAttempt.update({ where: { id: evaluation.assessmentAttemptId }, data: { status: 'RETURNED' } });
    return { evaluation: updated, changed: true };
  });
  if (result.changed) {
    await notifications.createNotification({
      userId: result.evaluation.enrollment.userId, type: 'WRITTEN_RESULT_PUBLISHED',
      title: 'Résultat écrit disponible', message: `Votre résultat pour « ${result.evaluation.assessment.title} » est disponible.`,
      actionUrl: `/student/written-attempts/${result.evaluation.assessmentAttemptId}/result`,
      relatedEntity: 'ASSESSMENT_EVALUATION', relatedId: result.evaluation.id,
      deduplicationKey: `WRITTEN_RESULT_PUBLISHED:evaluation-${result.evaluation.id}`,
    });
  }
  return result.evaluation;
}

async function attemptsFor(actorId, assessmentValue) {
  await require('./writtenAssessmentService').getManaged(assessmentValue, actorId);
  return prisma.assessmentAttempt.findMany({
    where: { assessmentId: validation.parseId(assessmentValue, 'évaluation') },
    include: { enrollment: { include: { user: { select: { firstName: true, lastName: true } } } }, evaluation: true, _count: { select: { responses: true } } },
    orderBy: { submittedAt: 'desc' },
  });
}

module.exports = { requireAttempt, grade, publish, attemptsFor };
