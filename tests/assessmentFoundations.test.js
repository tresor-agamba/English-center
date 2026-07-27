const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const validation = require('../src/services/assessmentValidationService');
const assessmentService = require('../src/services/assessmentService');

describe('fondations des évaluations', () => {
  it('expose les trois modes autour de Assessment', () => {
    assert.deepEqual(validation.ASSESSMENT_MODES, ['WRITTEN', 'RECORDED_ORAL', 'LIVE_VIDEO_ORAL']);
    assert.ok(Prisma.dmmf.datamodel.models.some(model => model.name === 'Assessment'));
    const modes = Prisma.dmmf.datamodel.enums.find(item => item.name === 'AssessmentMode');
    assert.deepEqual(modes.values.map(item => item.name), validation.ASSESSMENT_MODES);
  });

  it('ajoute JITSI sans retirer les plateformes existantes', () => {
    assert.deepEqual(validation.MEETING_PLATFORMS, [
      'GOOGLE_MEET', 'ZOOM', 'MICROSOFT_TEAMS', 'JITSI', 'OTHER',
    ]);
    assert.equal(validation.normalizeMeetingPlatform('Jitsi Meet'), 'JITSI');
  });

  it('associe strictement les types de questions au mode', () => {
    assert.equal(validation.validateQuestionType('RECORDED_ORAL', 'pronunciation'), 'PRONUNCIATION');
    assert.equal(validation.validateQuestionType('WRITTEN', 'essay'), 'ESSAY');
    assert.throws(
      () => validation.validateQuestionType('WRITTEN', 'PRONUNCIATION'),
      error => error.code === 'QUESTION_MODE_MISMATCH',
    );
    assert.throws(
      () => validation.validateQuestionType('LIVE_VIDEO_ORAL', 'SHORT_TEXT'),
      error => error.code === 'QUESTION_MODE_MISMATCH',
    );
  });

  it('refuse les identifiants, textes et nombres non valides', () => {
    assert.throws(() => validation.parseId('../1'), error => error.code === 'INVALID_ID');
    assert.throws(() => validation.requiredText(' ', 'Titre', 10), error => error.code === 'REQUIRED_FIELD');
    assert.throws(() => validation.parseInteger('1.5', 'Tentatives'), error => error.code === 'INVALID_INTEGER');
    assert.throws(() => validation.parseDecimal('-1', 'Points'), error => error.code === 'INVALID_DECIMAL');
  });

  it('valide les fenêtres temporelles et les URLs de réunion HTTPS', () => {
    const start = new Date('2026-08-01T10:00:00Z');
    const end = new Date('2026-08-01T11:00:00Z');
    assert.deepEqual(validation.validateDateRange(start, end), { start, end });
    assert.throws(() => validation.validateDateRange(end, start), error => error.code === 'INVALID_DATE_RANGE');
    assert.equal(validation.validatePrivateMeetingUrl('https://meet.example.test/room'), 'https://meet.example.test/room');
    assert.throws(() => validation.validatePrivateMeetingUrl('http://meet.example.test/room'), error => error.code === 'INVALID_MEETING_URL');
    assert.throws(() => validation.validatePrivateMeetingUrl('https://user:secret@example.test/room'), error => error.code === 'INVALID_MEETING_URL');
  });

  it('valide les transitions sans permettre un retour silencieux', () => {
    assert.equal(validation.validateAssessmentTransition('DRAFT', 'PUBLISHED'), 'PUBLISHED');
    assert.equal(validation.validateLiveOralTransition('IN_PROGRESS', 'COMPLETED'), 'COMPLETED');
    assert.throws(() => validation.validateLiveOralTransition('COMPLETED', 'SCHEDULED'), error => error.code === 'INVALID_STATUS_TRANSITION');
    assert.throws(() => validation.validateLiveOralTransition('GRADED', 'IN_PROGRESS'), error => error.code === 'INVALID_STATUS_TRANSITION');
  });

  it('exige une grille unique totalisant 100 % et le total des points', () => {
    const result = validation.validateCriteria([
      { code: 'PRONUNCIATION', label: 'Prononciation', weight: '40', maxScore: '8', position: 1 },
      { code: 'FLUENCY', label: 'Fluidité', weight: '60', maxScore: '12', position: 2 },
    ], new Prisma.Decimal(20));
    assert.equal(result.length, 2);
    assert.equal(result[0].weight.toString(), '40');
    assert.throws(() => validation.validateCriteria([
      { code: 'A', label: 'A', weight: '50', maxScore: '10', position: 1 },
    ], 20), error => error.code === 'INVALID_CRITERIA_WEIGHT');
    assert.throws(() => validation.validateCriteria([
      { code: 'A', label: 'A', weight: '50', maxScore: '5', position: 1 },
      { code: 'B', label: 'B', weight: '50', maxScore: '5', position: 2 },
    ], 20), error => error.code === 'INVALID_CRITERIA_SCORE');
  });

  it('vérifie la relation session-formation et construit un brouillon oral', async () => {
    const client = {
      course: { findUnique: async ({ where }) => where.id === 10 ? { id: 10 } : null },
      trainingSession: { findUnique: async ({ where }) => where.id === 20 ? { id: 20, courseId: 10 } : null },
    };
    const data = await assessmentService.buildFoundationData({
      title: 'Présentation orale',
      description: 'Évaluation de prise de parole.',
      instructions: 'Présentez votre projet.',
      mode: 'RECORDED_ORAL',
      courseId: 10,
      trainingSessionId: 20,
      totalPoints: 20,
      passingScore: 12,
      preparationSeconds: 60,
      maxAttempts: 2,
      maxRecordingSeconds: 300,
    }, 1, client);
    assert.equal(data.status, 'DRAFT');
    assert.equal(data.allowPlayback, true);
    assert.equal(data.maxRecordingSeconds, 300);
    await assert.rejects(
      () => assessmentService.buildFoundationData({
        title: 'Test', instructions: 'Test', mode: 'RECORDED_ORAL',
        courseId: 10, trainingSessionId: 20, totalPoints: 10, passingScore: 11,
        maxRecordingSeconds: 60,
      }, 1, client),
      error => error.code === 'PASSING_SCORE_TOO_HIGH',
    );
  });

  it('contient les modèles spécialisés et leurs contraintes d’unicité Prisma', () => {
    const names = new Set(Prisma.dmmf.datamodel.models.map(model => model.name));
    for (const name of [
      'AssessmentQuestion', 'AssessmentAttempt', 'AssessmentResponse',
      'AssessmentCriterion', 'AssessmentEvaluation', 'AssessmentCriterionScore',
      'LiveOralSession', 'LiveOralParticipant', 'LiveOralExaminer',
      'LiveOralAttendance', 'OralSessionEvent',
    ]) assert.ok(names.has(name), `${name} absent`);
  });
});
