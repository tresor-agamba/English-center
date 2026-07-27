const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const prisma = require('../src/utils/prisma');
const management = require('../src/services/recordedOralAssessmentService');
const attempts = require('../src/services/recordedOralAttemptService');
const evaluations = require('../src/services/recordedOralEvaluationService');
const audioAccess = require('../src/services/oralAudioAccessService');
const storage = require('../src/services/oralAudioStorageService');

function wavBuffer(seconds = 1, sampleRate = 8000) {
  const dataLength = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  buffer.fill(128, 44);
  return buffer;
}

test('Phase 2 — évaluations orales enregistrées', async t => {
  const key = `${Date.now()}-${process.pid}`;
  const userIds = [];
  const storageKeys = new Set();
  let course;
  async function createUser(index, role) {
    const row = await prisma.user.create({
      data: {
        firstName: 'Oral',
        lastName: `Test${index}`,
        phoneNumber: `+243990${key.slice(-6)}${index}`,
        passwordHash: 'test',
        role,
      },
    });
    userIds.push(row.id);
    return row;
  }
  async function temporaryAudio(name, seconds = 1, content = null) {
    await storage.ensureDirectories();
    const filePath = path.join(storage.TEMP_ROOT, `${key}-${name}.upload`);
    const buffer = content || wavBuffer(seconds);
    await fs.writeFile(filePath, buffer);
    return { path: filePath, size: buffer.length, originalname: `${name}.wav`, mimetype: 'audio/wav' };
  }
  const body = overrides => ({
    title: `Oral ${key}`,
    description: 'Évaluation orale de contrôle.',
    instructions: 'Répondez clairement.',
    courseId: course.id,
    trainingSessionId: '',
    totalPoints: '20',
    passingScore: '10',
    maxAttempts: '1',
    maxRecordingSeconds: '5',
    allowPlayback: 'on',
    questions: JSON.stringify([{
      type: 'PRONUNCIATION',
      prompt: 'Présentez-vous.',
      preparationSeconds: 0,
      maxResponseSeconds: 2,
      maxAttempts: 2,
      position: 1,
      points: 20,
      isRequired: true,
    }]),
    criteria: JSON.stringify([
      { code: 'PRONUNCIATION', label: 'Prononciation', weight: 50, maxScore: 10, position: 1 },
      { code: 'FLUENCY', label: 'Fluidité', weight: 50, maxScore: 10, position: 2 },
    ]),
    ...overrides,
  });

  try {
    const admin = await createUser(1, 'ADMIN');
    const teacher = await createUser(2, 'TEACHER');
    const outsiderTeacher = await createUser(3, 'TEACHER');
    const student = await createUser(4, 'STUDENT');
    const otherStudent = await createUser(5, 'STUDENT');
    course = await prisma.course.create({ data: { title: `Oral course ${key}`, slug: `oral-${key}` } });
    const session = await prisma.trainingSession.create({
      data: {
        name: 'Cohorte orale',
        courseId: course.id,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2027-12-31'),
        registrationDeadline: new Date('2025-12-01'),
        capacity: 20,
        status: 'ONGOING',
      },
    });
    await prisma.trainingSessionTeacher.create({ data: { trainingSessionId: session.id, teacherId: teacher.id } });
    const enrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: session.id, status: 'CONFIRMED' } });
    await prisma.enrollment.create({ data: { userId: otherStudent.id, trainingSessionId: session.id, status: 'CONFIRMED' } });

    let assessment;
    await t.test('création administrateur, enseignant autorisé et refus non autorisé', async () => {
      assessment = await management.create(body(), admin.id);
      assert.equal(assessment.mode, 'RECORDED_ORAL');
      assert.equal(assessment.status, 'DRAFT');
      const teacherAssessment = await management.create(body({ title: `Teacher oral ${key}`, trainingSessionId: session.id }), teacher.id);
      assert.equal(teacherAssessment.createdById, teacher.id);
      await assert.rejects(
        () => management.create(body({ title: `Forbidden ${key}`, trainingSessionId: session.id }), outsiderTeacher.id),
        error => error.code === 'ACCESS_DENIED',
      );
    });

    await t.test('refuse une publication incomplète puis publie une configuration valide', async () => {
      const incomplete = await management.create(body({ title: `Incomplete ${key}`, questions: '[]', criteria: undefined }), admin.id);
      await assert.rejects(() => management.publish(incomplete.id, admin.id), error => error.code === 'QUESTIONS_REQUIRED');
      const published = await management.publish(assessment.id, admin.id);
      assert.equal(published.status, 'PUBLISHED');
      assert.ok(await prisma.notification.findFirst({ where: { userId: student.id, type: 'RECORDED_ORAL_PUBLISHED', relatedId: assessment.id } }));
      await assert.rejects(() => management.updateDraft(assessment.id, body(), admin.id), error => error.code === 'ASSESSMENT_LOCKED');
    });

    let attempt;
    await t.test('contrôle inscription, dates et création atomique de tentative', async () => {
      const concurrent = await Promise.all([
        attempts.startAttempt(student.id, assessment.id),
        attempts.startAttempt(student.id, assessment.id),
      ]);
      assert.equal(concurrent[0].id, concurrent[1].id);
      attempt = concurrent[0];
      assert.equal(await prisma.assessmentAttempt.count({ where: { assessmentId: assessment.id, enrollmentId: enrollment.id } }), 1);
      const stranger = await createUser(6, 'STUDENT');
      await assert.rejects(() => attempts.startAttempt(stranger.id, assessment.id), error => error.code === 'ACCESS_DENIED');
      const future = await management.create(body({ title: `Future ${key}`, openAt: '2099-01-01T00:00:00Z' }), admin.id);
      await management.publish(future.id, admin.id);
      await assert.rejects(() => attempts.startAttempt(student.id, future.id), error => error.code === 'ASSESSMENT_NOT_OPEN');
      const closed = await management.create(body({ title: `Closed ${key}`, closeAt: '2020-01-01T00:00:00Z' }), admin.id);
      await management.publish(closed.id, admin.id);
      await assert.rejects(() => attempts.startAttempt(student.id, closed.id), error => error.code === 'ASSESSMENT_CLOSED');
    });

    let response;
    await t.test('détecte réellement le format, la durée et les remplacements', async () => {
      const questionId = assessment.questions[0].id;
      const fake = await temporaryAudio('fake', 1, Buffer.from('not an audio file'));
      await assert.rejects(() => attempts.saveAudioResponse(student.id, attempt.id, questionId, fake), error => error.code === 'AUDIO_TYPE_INVALID');
      const long = await temporaryAudio('long', 3);
      await assert.rejects(() => attempts.saveAudioResponse(student.id, attempt.id, questionId, long), error => error.code === 'AUDIO_TOO_LONG');
      response = await attempts.saveAudioResponse(student.id, attempt.id, questionId, await temporaryAudio('first'));
      storageKeys.add(response.audioStorageKey);
      assert.equal(response.audioMimeType, 'audio/wav');
      assert.equal(response.audioDurationSeconds, 1);
      const replaced = await attempts.saveAudioResponse(student.id, attempt.id, questionId, await temporaryAudio('replacement'));
      storageKeys.add(replaced.audioStorageKey);
      response = replaced;
      assert.equal(replaced.replacementCount, 1);
      await assert.rejects(
        async () => attempts.saveAudioResponse(student.id, attempt.id, questionId, await temporaryAudio('third')),
        error => error.code === 'REPLACEMENT_LIMIT_REACHED',
      );
      await assert.rejects(
        async () => attempts.saveAudioResponse(otherStudent.id, attempt.id, questionId, await temporaryAudio('idor')),
        error => error.code === 'ATTEMPT_NOT_FOUND',
      );
    });

    await t.test('soumet définitivement sans note automatique et verrouille', async () => {
      const submitted = await attempts.submit(student.id, attempt.id);
      assert.equal(submitted.status, 'SUBMITTED');
      assert.equal(await prisma.assessmentEvaluation.count({ where: { assessmentAttemptId: attempt.id } }), 0);
      await assert.rejects(
        async () => attempts.saveAudioResponse(student.id, attempt.id, assessment.questions[0].id, await temporaryAudio('locked')),
        error => error.code === 'ATTEMPT_LOCKED',
      );
      await assert.rejects(() => attempts.startAttempt(student.id, assessment.id), error => error.code === 'ATTEMPT_LIMIT_REACHED');
    });

    await t.test('protège la lecture audio par propriétaire et affectation', async () => {
      const own = await audioAccess.forStudent(student.id, response.id);
      assert.ok(own.file.size > 44);
      await assert.rejects(() => audioAccess.forStudent(otherStudent.id, response.id), error => error.code === 'ACCESS_DENIED');
      assert.ok((await audioAccess.forStaff(teacher.id, response.id)).file.size > 44);
      await assert.rejects(() => audioAccess.forStaff(outsiderTeacher.id, response.id), error => error.code === 'ACCESS_DENIED');
      assert.doesNotMatch(response.audioStorageKey, /oral|test/i);
    });

    let evaluation;
    await t.test('corrige avec la grille et masque le brouillon à l’étudiant', async () => {
      await assert.rejects(
        () => evaluations.saveDraft(outsiderTeacher.id, attempt.id, { scores: [] }),
        error => error.code === 'ACCESS_DENIED',
      );
      await assert.rejects(
        () => evaluations.saveDraft(teacher.id, attempt.id, {
          scores: [{ criterionId: assessment.criteria[0].id, score: 11 }, { criterionId: assessment.criteria[1].id, score: 5 }],
        }),
        error => error.code === 'SCORE_TOO_HIGH',
      );
      evaluation = await evaluations.saveDraft(teacher.id, attempt.id, {
        scores: [
          { criterionId: assessment.criteria[0].id, score: 8, comment: 'Bonne articulation.' },
          { criterionId: assessment.criteria[1].id, score: 7 },
        ],
        strengths: 'Prononciation claire.',
        improvements: 'Développer la fluidité.',
        feedback: 'Bon travail.',
        decision: 'PASSED',
      });
      assert.equal(Number(evaluation.overallScore), 15);
      await assert.rejects(() => attempts.studentResult(student.id, attempt.id), error => error.code === 'RESULT_NOT_PUBLISHED');
    });

    await t.test('publie le résultat de façon idempotente', async () => {
      const published = await evaluations.publish(teacher.id, evaluation.id);
      assert.equal(published.status, 'PUBLISHED');
      assert.equal((await attempts.studentResult(student.id, attempt.id)).evaluation.decision, 'PASSED');
      assert.equal((await evaluations.publish(teacher.id, evaluation.id)).id, evaluation.id);
      assert.equal(await prisma.notification.count({ where: { userId: student.id, type: 'RECORDED_ORAL_RESULT_PUBLISHED', relatedId: evaluation.id } }), 1);
    });

    await t.test('stockage privé absent du répertoire public et traversal refusé', async () => {
      assert.equal(storage.PRIVATE_ROOT.startsWith(path.resolve(__dirname, '..', 'public')), false);
      assert.throws(() => storage.resolveStorageKey('../../public/file.wav'), error => error.code === 'AUDIO_PATH_INVALID');
    });
  } finally {
    const responses = await prisma.assessmentResponse.findMany({
      where: { assessmentAttempt: { assessment: { courseId: course?.id } } },
      select: { audioStorageKey: true },
    }).catch(() => []);
    responses.forEach(item => storageKeys.add(item.audioStorageKey));
    await prisma.assessmentEvaluation.deleteMany({ where: { assessment: { courseId: course?.id } } }).catch(() => {});
    await prisma.assessmentAttempt.deleteMany({ where: { assessment: { courseId: course?.id } } }).catch(() => {});
    await prisma.assessment.deleteMany({ where: { courseId: course?.id } }).catch(() => {});
    if (course) await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    for (const storageKey of storageKeys) await storage.remove(storageKey).catch(() => {});
    await storage.cleanupTemporaryFiles(0).catch(() => {});
  }
});
