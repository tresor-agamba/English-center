const prisma = require('../utils/prisma');

const LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
const QUESTIONS = Object.freeze([
  { id: 'q1', prompt: 'Choose the correct form: I ___ English every day.', options: ['study', 'studies', 'studying'], answer: 'study' },
  { id: 'q2', prompt: 'Choose the past form of “go”.', options: ['goed', 'went', 'gone'], answer: 'went' },
  { id: 'q3', prompt: 'Complete: She has lived here ___ 2020.', options: ['for', 'since', 'during'], answer: 'since' },
  { id: 'q4', prompt: 'Choose the correct sentence.', options: ['He can swim.', 'He can swims.', 'He cans swim.'], answer: 'He can swim.' },
  { id: 'q5', prompt: 'A synonym of “difficult” is:', options: ['easy', 'challenging', 'quiet'], answer: 'challenging' },
  { id: 'q6', prompt: 'Complete: If I had time, I ___ travel more.', options: ['will', 'would', 'am'], answer: 'would' },
  { id: 'q7', prompt: 'Choose the passive form: They built the house.', options: ['The house was built.', 'The house built.', 'The house is build.'], answer: 'The house was built.' },
  { id: 'q8', prompt: 'Complete: I wish I ___ speak faster.', options: ['can', 'could', 'will'], answer: 'could' },
  { id: 'q9', prompt: '“Despite the rain” means:', options: ['because it rained', 'although it rained', 'before it rained'], answer: 'although it rained' },
  { id: 'q10', prompt: 'Choose the most formal option.', options: ['Send me details.', 'Could you please provide the details?', 'Give details.'], answer: 'Could you please provide the details?' },
]);

class PlacementTestError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message); this.code = code; this.statusCode = statusCode;
  }
}

function recommendedLevel(score) {
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new PlacementTestError('INVALID_SCORE', 'Résultat du test invalide.');
  if (value < 50) return 'LEVEL_1';
  if (value < 75) return 'LEVEL_2';
  return 'LEVEL_3';
}

function scoreAnswers(answers = {}) {
  const correct = QUESTIONS.filter((question) => answers[question.id] === question.answer).length;
  return Math.round((correct / QUESTIONS.length) * 100);
}

async function getPendingEnrollment(enrollmentId, studentId, client = prisma) {
  const id = Number(enrollmentId);
  if (!Number.isInteger(id) || id <= 0) throw new PlacementTestError('NOT_FOUND', 'Test de niveau introuvable.', 404);
  const enrollment = await client.enrollment.findFirst({
    where: { id, userId: Number(studentId) },
    include: { trainingSession: { include: { course: { select: { title: true } } } } },
  });
  if (!enrollment) throw new PlacementTestError('NOT_FOUND', 'Test de niveau introuvable.', 404);
  if (!enrollment.placementTestRequired || enrollment.status !== 'PLACEMENT_TEST_REQUIRED') {
    throw new PlacementTestError('TEST_NOT_REQUIRED', 'Aucun test de niveau n’est requis pour cette inscription.');
  }
  return enrollment;
}

async function completePlacement({ enrollmentId, studentId, score }) {
  const level = recommendedLevel(score);
  return prisma.$transaction(async (tx) => {
    const enrollment = await getPendingEnrollment(enrollmentId, studentId, tx);
    return tx.enrollment.update({
      where: { id: enrollment.id },
      data: {
        recommendedLevel: level,
        approvedLevel: level,
        placementTestScore: Math.round(Number(score)),
        placementTestCompletedAt: new Date(),
        status: 'TRIAL_ACTIVE',
      },
      include: { trainingSession: { include: { course: { select: { title: true } } } } },
    });
  });
}

module.exports = {
  LEVELS, QUESTIONS, PlacementTestError, recommendedLevel, scoreAnswers, getPendingEnrollment, completePlacement,
};
