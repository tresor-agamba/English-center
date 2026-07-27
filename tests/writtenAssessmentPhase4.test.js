const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const assessments = require('../src/services/writtenAssessmentService');
const attempts = require('../src/services/writtenAttemptService');
const evaluations = require('../src/services/writtenEvaluationService');

test('Phase 4 — évaluations écrites', async t => {
  const key = `${Date.now()}${process.pid}`;
  const userIds = [];
  let course;
  const createUser = async (name, role) => {
    const user = await prisma.user.create({
      data: { firstName: 'Written', lastName: name, phoneNumber: `+24377${key.slice(-7)}${userIds.length}`, passwordHash: 'test', role },
    });
    userIds.push(user.id);
    return user;
  };
  try {
    const admin = await createUser('Admin', 'ADMIN');
    const teacher = await createUser('Teacher', 'TEACHER');
    const outsiderTeacher = await createUser('Outsider', 'TEACHER');
    const student = await createUser('Student', 'STUDENT');
    const otherStudent = await createUser('Other', 'STUDENT');
    course = await prisma.course.create({ data: { title: `Written ${key}`, slug: `written-${key}` } });
    const training = await prisma.trainingSession.create({
      data: {
        name: 'Cohorte écrite', courseId: course.id, startDate: new Date('2026-01-01'),
        endDate: new Date('2027-12-31'), registrationDeadline: new Date('2026-01-01'),
        capacity: 20, status: 'ONGOING',
      },
    });
    await prisma.trainingSessionTeacher.create({ data: { trainingSessionId: training.id, teacherId: teacher.id } });
    const enrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: training.id, status: 'CONFIRMED' } });
    await prisma.enrollment.create({ data: { userId: otherStudent.id, trainingSessionId: training.id, status: 'CONFIRMED' } });
    const body = overrides => ({
      title: `Written test ${key}`, instructions: 'Répondez à toutes les questions.',
      courseId: course.id, trainingSessionId: training.id, totalPoints: 20, passingScore: 10,
      timeLimitMinutes: 30, maxAttempts: 1,
      questions: [
        { type: 'MULTIPLE_CHOICE', prompt: 'Capital of DRC?', options: ['Kinshasa', 'Goma'], expectedAnswer: 'Kinshasa', points: 5, position: 1, explanation: 'Kinshasa est la capitale.' },
        { type: 'MULTIPLE_SELECT', prompt: 'Select vowels', options: ['a', 'b', 'e'], expectedAnswer: ['a', 'e'], points: 5, position: 2 },
        { type: 'LONG_TEXT', prompt: 'Introduce yourself.', points: 10, position: 3 },
      ],
      ...overrides,
    });
    let assessment;

    await t.test('crée avec tous les fondements et contrôle les permissions', async () => {
      assessment = await assessments.create(body(), admin.id);
      assert.equal(assessment.mode, 'WRITTEN');
      assert.equal(assessment.timeLimitMinutes, 30);
      assert.equal(assessment.questions.length, 3);
      assessment = await assessments.updateDraft(assessment.id, body({ title: `Written updated ${key}` }), admin.id);
      assert.equal(assessment.title, `Written updated ${key}`);
      const byTeacher = await assessments.create(body({ title: `Teacher ${key}` }), teacher.id);
      assert.equal(byTeacher.createdById, teacher.id);
      await assert.rejects(() => assessments.create(body({ title: `Forbidden ${key}` }), outsiderTeacher.id), error => error.code === 'ACCESS_DENIED');
      await assert.rejects(
        () => assessments.create(body({ title: `Invalid ${key}`, questions: [{ type: 'MULTIPLE_CHOICE', prompt: 'Missing answer', options: ['a'], points: 20 }] }), admin.id),
        error => error.code === 'EXPECTED_ANSWER_REQUIRED',
      );
    });

    await t.test('publie et ne divulgue jamais les réponses correctes', async () => {
      await assessments.publish(assessment.id, admin.id);
      const context = await attempts.context(student.id, assessment.id);
      assert.equal(context.assessment.status, 'PUBLISHED');
      assert.ok(context.assessment.questions.every(question => !Object.hasOwn(question, 'expectedAnswer')));
      assert.ok(context.assessment.questions.every(question => !Object.hasOwn(question, 'explanation')));
      assert.ok(await prisma.notification.findFirst({ where: { userId: student.id, type: 'WRITTEN_ASSESSMENT_PUBLISHED', relatedId: assessment.id } }));
      await assert.rejects(() => assessments.publish(assessment.id, outsiderTeacher.id), error => error.code === 'ACCESS_DENIED');
      await assert.rejects(() => assessments.updateDraft(assessment.id, body(), admin.id), error => error.code === 'ASSESSMENT_LOCKED');
    });

    let attempt;
    await t.test('crée une seule tentative concurrente et isole les étudiants', async () => {
      const concurrent = await Promise.all([attempts.start(student.id, assessment.id), attempts.start(student.id, assessment.id)]);
      assert.equal(concurrent[0].id, concurrent[1].id);
      attempt = concurrent[0];
      assert.ok(attempt.expiresAt);
      await assert.rejects(() => attempts.requireOwned(otherStudent.id, attempt.id), error => error.code === 'ATTEMPT_NOT_FOUND');
    });

    await t.test('sauvegarde le brouillon et corrige uniquement les réponses objectives', async () => {
      const [q1, q2, q3] = assessment.questions;
      const first = await attempts.saveResponse(student.id, attempt.id, q1.id, { selectedOptions: 'Kinshasa' });
      const second = await attempts.saveResponse(student.id, attempt.id, q2.id, { selectedOptions: ['e', 'a'] });
      const manual = await attempts.saveResponse(student.id, attempt.id, q3.id, { textResponse: 'My name is Student.' });
      assert.equal(Number(first.awardedPoints), 5);
      assert.equal(Number(second.awardedPoints), 5);
      assert.equal(manual.awardedPoints, null);
      assert.equal(manual.isAutoGraded, false);
    });

    await t.test('soumet définitivement sans noter automatiquement le texte', async () => {
      const submitted = await attempts.submit(student.id, attempt.id);
      assert.equal(submitted.status, 'SUBMITTED');
      assert.equal(await prisma.assessmentEvaluation.count({ where: { assessmentAttemptId: attempt.id } }), 0);
      await assert.rejects(
        () => attempts.saveResponse(student.id, attempt.id, assessment.questions[0].id, { selectedOptions: 'Goma' }),
        error => error.code === 'ATTEMPT_LOCKED',
      );
      await assert.rejects(() => attempts.start(student.id, assessment.id), error => error.code === 'ATTEMPT_LIMIT_REACHED');
    });

    let evaluation;
    await t.test('combine correction automatique et manuelle côté serveur', async () => {
      await assert.rejects(
        () => evaluations.grade(teacher.id, attempt.id, { scores: [{ questionId: assessment.questions[2].id, score: 11 }] }),
        error => error.code === 'SCORE_TOO_HIGH',
      );
      await assert.rejects(() => evaluations.grade(outsiderTeacher.id, attempt.id, { scores: [] }), error => error.code === 'ACCESS_DENIED');
      evaluation = await evaluations.grade(teacher.id, attempt.id, {
        scores: [{ questionId: assessment.questions[2].id, score: 8, feedback: 'Bonne rédaction.' }],
        feedback: 'Bon résultat.', strengths: 'Compréhension.', improvements: 'Développer les réponses.',
      });
      assert.equal(Number(evaluation.overallScore), 18);
      await assert.rejects(() => attempts.result(student.id, attempt.id), error => error.code === 'RESULT_NOT_PUBLISHED');
    });

    await t.test('publie le résultat une seule fois puis révèle explications et note', async () => {
      await evaluations.publish(teacher.id, evaluation.id);
      await evaluations.publish(teacher.id, evaluation.id);
      const result = await attempts.result(student.id, attempt.id);
      assert.equal(Number(result.evaluation.overallScore), 18);
      assert.equal(result.assessment.questions[0].explanation, 'Kinshasa est la capitale.');
      assert.ok(result.assessment.questions.every(question => !Object.hasOwn(question, 'expectedAnswer')));
      assert.equal(await prisma.notification.count({ where: { userId: student.id, type: 'WRITTEN_RESULT_PUBLISHED', relatedId: evaluation.id } }), 1);
      await assert.rejects(() => evaluations.grade(teacher.id, attempt.id, { scores: [] }), error => error.code === 'EVALUATION_LOCKED');
    });

    await t.test('le serveur soumet automatiquement à expiration', async () => {
      const timed = await assessments.create(body({
        title: `Timed ${key}`, timeLimitMinutes: 1, maxAttempts: 1,
        questions: [{ type: 'TRUE_FALSE', prompt: 'English is a language.', expectedAnswer: 'true', points: 20, position: 1 }],
      }), admin.id);
      await assessments.publish(timed.id, admin.id);
      const timedAttempt = await attempts.start(otherStudent.id, timed.id, new Date('2026-07-27T10:00:00Z'));
      await assert.rejects(
        () => attempts.saveResponse(otherStudent.id, timedAttempt.id, timed.questions[0].id, { selectedOptions: 'true' }, new Date('2026-07-27T10:01:01Z')),
        error => error.code === 'TIME_LIMIT_EXCEEDED',
      );
      const stored = await prisma.assessmentAttempt.findUnique({ where: { id: timedAttempt.id } });
      assert.equal(stored.status, 'GRADED');
      assert.ok(stored.autoSubmittedAt);
    });

    await t.test('ferme l’évaluation sans supprimer les tentatives', async () => {
      const closed = await assessments.close(assessment.id, admin.id);
      assert.equal(closed.status, 'CLOSED');
      assert.ok(await prisma.assessmentAttempt.findUnique({ where: { id: attempt.id } }));
      await assert.rejects(() => attempts.context(student.id, assessment.id), error => error.code === 'ASSESSMENT_UNAVAILABLE');
    });
  } finally {
    if (course) {
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
      await prisma.assessmentEvaluation.deleteMany({ where: { assessment: { courseId: course.id } } }).catch(() => {});
      await prisma.assessmentAttempt.deleteMany({ where: { assessment: { courseId: course.id } } }).catch(() => {});
      await prisma.assessment.deleteMany({ where: { courseId: course.id } }).catch(() => {});
      await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
  }
});
