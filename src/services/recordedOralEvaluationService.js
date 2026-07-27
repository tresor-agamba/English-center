const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const management = require('./recordedOralAssessmentService');
const notifications = require('./notificationService');

function collection(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new validation.AssessmentValidationError('INVALID_SCORES', 'Les notes par critère sont invalides.');
}

async function requireAttempt(actorId, attemptValue, client = prisma) {
  const attempt = await client.assessmentAttempt.findUnique({
    where: { id: validation.parseId(attemptValue, 'tentative') },
    include: {
      assessment: {
        include: {
          course: true,
          trainingSession: true,
          criteria: { orderBy: { position: 'asc' } },
          questions: { orderBy: { position: 'asc' } },
        },
      },
      enrollment: { include: { user: { select: { firstName: true, lastName: true } } } },
      responses: { include: { assessmentQuestion: true } },
      evaluation: { include: { criterionScores: true } },
    },
  });
  if (!attempt || attempt.assessment.mode !== 'RECORDED_ORAL') {
    throw new validation.AssessmentValidationError('ATTEMPT_NOT_FOUND', 'Tentative introuvable.', 404);
  }
  await management.requireManager(actorId, attempt.assessment, client);
  return attempt;
}

function calculateScores(criteria, submittedScores, totalPoints) {
  const entries = collection(submittedScores);
  if (entries.length !== criteria.length) throw new validation.AssessmentValidationError('INCOMPLETE_SCORES', 'Tous les critères doivent être notés.');
  const byId = new Map(entries.map(item => [validation.parseId(item.criterionId, 'critère'), item]));
  let weightedRatio = new Prisma.Decimal(0);
  const scores = criteria.map(criterion => {
    const entry = byId.get(criterion.id);
    if (!entry) throw new validation.AssessmentValidationError('INCOMPLETE_SCORES', 'Tous les critères doivent être notés.');
    const score = validation.parseDecimal(entry.score, `La note « ${criterion.label} »`);
    if (score.gt(criterion.maxScore)) throw new validation.AssessmentValidationError('SCORE_TOO_HIGH', `La note « ${criterion.label} » dépasse son maximum.`);
    weightedRatio = weightedRatio.plus(
      score.div(criterion.maxScore).mul(criterion.weight).div(100),
    );
    return {
      assessmentCriterionId: criterion.id,
      score,
      criterionLabelSnapshot: criterion.label,
      criterionWeightSnapshot: criterion.weight,
      criterionMaxScoreSnapshot: criterion.maxScore,
      comment: validation.optionalText(entry.comment, 'Le commentaire du critère', 5000),
    };
  });
  return { scores, overallScore: weightedRatio.mul(totalPoints).toDecimalPlaces(2) };
}

async function saveDraft(actorId, attemptValue, body) {
  return prisma.$transaction(async tx => {
    const attempt = await requireAttempt(actorId, attemptValue, tx);
    if (!['SUBMITTED', 'GRADED'].includes(attempt.status)) {
      throw new validation.AssessmentValidationError('ATTEMPT_NOT_SUBMITTED', 'La tentative doit être soumise avant correction.');
    }
    if (attempt.evaluation?.status === 'PUBLISHED') {
      throw new validation.AssessmentValidationError('EVALUATION_LOCKED', 'Le résultat publié ne peut plus être modifié.', 409);
    }
    const { scores, overallScore } = calculateScores(attempt.assessment.criteria, body.scores, attempt.assessment.totalPoints);
    if (body.overallScore !== undefined && body.overallScore !== '') {
      const claimed = validation.parseDecimal(body.overallScore, 'La note globale');
      if (!claimed.equals(overallScore)) throw new validation.AssessmentValidationError('OVERALL_SCORE_MISMATCH', 'La note globale ne correspond pas à la grille.');
    }
    const decision = String(body.decision || 'UNDECIDED').toUpperCase();
    if (!['UNDECIDED', 'PASSED', 'FAILED'].includes(decision)) {
      throw new validation.AssessmentValidationError('INVALID_DECISION', 'Décision invalide.');
    }
    const evaluationData = {
      assessmentId: attempt.assessmentId,
      enrollmentId: attempt.enrollmentId,
      assessmentAttemptId: attempt.id,
      evaluatorId: validation.parseId(actorId, 'évaluateur'),
      status: 'DRAFT',
      overallScore,
      feedback: validation.optionalText(body.feedback, 'Le feedback', 20000),
      strengths: validation.optionalText(body.strengths, 'Les points forts', 10000),
      improvements: validation.optionalText(body.improvements, 'Les axes d’amélioration', 10000),
      decision,
      gradedAt: new Date(),
    };
    let evaluation;
    if (attempt.evaluation) {
      await tx.assessmentCriterionScore.deleteMany({ where: { assessmentEvaluationId: attempt.evaluation.id } });
      evaluation = await tx.assessmentEvaluation.update({
        where: { id: attempt.evaluation.id },
        data: { ...evaluationData, criterionScores: { create: scores } },
        include: { criterionScores: true },
      });
    } else {
      evaluation = await tx.assessmentEvaluation.create({
        data: { ...evaluationData, criterionScores: { create: scores } },
        include: { criterionScores: true },
      });
    }
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'GRADED', gradedAt: new Date() },
    });
    return evaluation;
  });
}

async function publish(actorId, evaluationValue) {
  const result = await prisma.$transaction(async tx => {
    const evaluation = await tx.assessmentEvaluation.findUnique({
      where: { id: validation.parseId(evaluationValue, 'évaluation') },
      include: {
        assessment: { include: { course: true, trainingSession: true, criteria: true } },
        assessmentAttempt: true,
        criterionScores: true,
        enrollment: true,
      },
    });
    if (!evaluation || !evaluation.assessmentAttempt || evaluation.assessment.mode !== 'RECORDED_ORAL') {
      throw new validation.AssessmentValidationError('EVALUATION_NOT_FOUND', 'Correction introuvable.', 404);
    }
    await management.requireManager(actorId, evaluation.assessment, tx);
    if (evaluation.status === 'PUBLISHED') return { evaluation, changed: false };
    if (evaluation.criterionScores.length !== evaluation.assessment.criteria.length || !evaluation.gradedAt) {
      throw new validation.AssessmentValidationError('EVALUATION_INCOMPLETE', 'La correction est incomplète.');
    }
    const updated = await tx.assessmentEvaluation.update({
      where: { id: evaluation.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { assessment: true, enrollment: true },
    });
    await tx.assessmentAttempt.update({
      where: { id: evaluation.assessmentAttempt.id },
      data: { status: 'RETURNED' },
    });
    return { evaluation: updated, changed: true };
  });
  if (result.changed) {
    await notifications.createNotification({
      userId: result.evaluation.enrollment.userId,
      type: 'RECORDED_ORAL_RESULT_PUBLISHED',
      title: 'Résultat d’évaluation orale disponible',
      message: `Votre résultat pour « ${result.evaluation.assessment.title} » est disponible.`,
      actionUrl: `/student/oral-attempts/${result.evaluation.assessmentAttemptId}/result`,
      relatedEntity: 'ASSESSMENT_EVALUATION',
      relatedId: result.evaluation.id,
      deduplicationKey: `RECORDED_ORAL_RESULT_PUBLISHED:evaluation-${result.evaluation.id}`,
    });
  }
  return result.evaluation;
}

async function submissionRows(actorId, assessmentValue) {
  const assessment = await management.getManaged(assessmentValue, actorId);
  return prisma.assessmentAttempt.findMany({
    where: { assessmentId: assessment.id, status: { in: ['SUBMITTED', 'GRADED', 'RETURNED'] } },
    include: {
      enrollment: { include: { user: { select: { firstName: true, lastName: true } } } },
      evaluation: true,
      _count: { select: { responses: true } },
    },
    orderBy: { submittedAt: 'desc' },
  });
}

module.exports = { requireAttempt, calculateScores, saveDraft, publish, submissionRows };
