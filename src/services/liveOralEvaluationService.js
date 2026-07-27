const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const access = require('./liveOralAccessService');
const recordedEvaluation = require('./recordedOralEvaluationService');
const notifications = require('./notificationService');

async function saveDraft(teacherId, sessionValue, enrollmentValue, body) {
  return prisma.$transaction(async tx => {
    const session = await access.requireExaminer(teacherId, sessionValue, {}, tx);
    if (!['COMPLETED', 'GRADED'].includes(session.status)) {
      throw new validation.AssessmentValidationError(
        'SESSION_NOT_COMPLETED',
        'La session doit être terminée avant la notation.',
      );
    }
    const enrollmentId = validation.parseId(enrollmentValue, 'inscription');
    if (!session.participants.some(item => item.enrollmentId === enrollmentId)) {
      throw new validation.AssessmentValidationError('PARTICIPANT_NOT_FOUND', 'Participant introuvable.', 404);
    }
    const existing = session.evaluations.find(item => item.enrollmentId === enrollmentId);
    if (existing?.status === 'PUBLISHED') {
      throw new validation.AssessmentValidationError('EVALUATION_LOCKED', 'Le résultat publié ne peut plus être modifié.', 409);
    }
    const { scores, overallScore } = recordedEvaluation.calculateScores(
      session.assessment.criteria,
      body.scores,
      session.assessment.totalPoints,
    );
    if (body.overallScore !== undefined && body.overallScore !== '') {
      const claimed = validation.parseDecimal(body.overallScore, 'La note globale');
      if (!claimed.equals(overallScore)) {
        throw new validation.AssessmentValidationError('OVERALL_SCORE_MISMATCH', 'La note globale ne correspond pas à la grille.');
      }
    }
    const decision = String(body.decision || 'UNDECIDED').toUpperCase();
    if (!['UNDECIDED', 'PASSED', 'FAILED'].includes(decision)) {
      throw new validation.AssessmentValidationError('INVALID_DECISION', 'Décision invalide.');
    }
    const data = {
      assessmentId: session.assessmentId,
      enrollmentId,
      liveOralSessionId: session.id,
      evaluatorId: validation.parseId(teacherId, 'évaluateur'),
      status: 'DRAFT',
      overallScore,
      feedback: validation.optionalText(body.feedback, 'Le feedback', 20000),
      strengths: validation.optionalText(body.strengths, 'Les points forts', 10000),
      improvements: validation.optionalText(body.improvements, 'Les axes d’amélioration', 10000),
      decision,
      gradedAt: new Date(),
    };
    let evaluation;
    if (existing) {
      await tx.assessmentCriterionScore.deleteMany({ where: { assessmentEvaluationId: existing.id } });
      evaluation = await tx.assessmentEvaluation.update({
        where: { id: existing.id },
        data: { ...data, criterionScores: { create: scores } },
        include: { criterionScores: true },
      });
    } else {
      evaluation = await tx.assessmentEvaluation.create({
        data: { ...data, criterionScores: { create: scores } },
        include: { criterionScores: true },
      });
    }
    const evaluationCount = await tx.assessmentEvaluation.count({
      where: { liveOralSessionId: session.id, gradedAt: { not: null } },
    });
    if (session.status === 'COMPLETED' && evaluationCount === session.participants.length) {
      await tx.liveOralSession.update({ where: { id: session.id }, data: { status: 'GRADED' } });
      await tx.oralSessionEvent.create({
        data: { liveOralSessionId: session.id, actorId: teacherId, action: 'GRADED', fromStatus: 'COMPLETED', toStatus: 'GRADED' },
      });
    }
    return evaluation;
  });
}

async function publish(teacherId, evaluationValue) {
  const result = await prisma.$transaction(async tx => {
    const evaluation = await tx.assessmentEvaluation.findUnique({
      where: { id: validation.parseId(evaluationValue, 'évaluation') },
      include: {
        assessment: { include: { criteria: true } },
        enrollment: true,
        liveOralSession: true,
        criterionScores: true,
      },
    });
    if (!evaluation?.liveOralSession || evaluation.assessment.mode !== 'LIVE_VIDEO_ORAL') {
      throw new validation.AssessmentValidationError('EVALUATION_NOT_FOUND', 'Correction introuvable.', 404);
    }
    await access.requireExaminer(teacherId, evaluation.liveOralSessionId, {}, tx);
    if (evaluation.status === 'PUBLISHED') return { evaluation, changed: false };
    if (!evaluation.gradedAt || evaluation.criterionScores.length !== evaluation.assessment.criteria.length) {
      throw new validation.AssessmentValidationError('EVALUATION_INCOMPLETE', 'La correction est incomplète.');
    }
    const updated = await tx.assessmentEvaluation.update({
      where: { id: evaluation.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { assessment: true, enrollment: true },
    });
    return { evaluation: updated, changed: true };
  });
  if (result.changed) {
    await notifications.createNotification({
      userId: result.evaluation.enrollment.userId,
      type: 'LIVE_ORAL_RESULT_PUBLISHED',
      title: 'Résultat de votre oral disponible',
      message: `Votre résultat pour « ${result.evaluation.assessment.title} » est disponible.`,
      actionUrl: `/student/live-oral-sessions/${result.evaluation.liveOralSessionId}`,
      relatedEntity: 'ASSESSMENT_EVALUATION',
      relatedId: result.evaluation.id,
      deduplicationKey: `LIVE_ORAL_RESULT_PUBLISHED:evaluation-${result.evaluation.id}`,
    });
  }
  return result.evaluation;
}

module.exports = { saveDraft, publish };
