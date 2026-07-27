const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const assessmentService = require('../src/services/liveOralAssessmentService');
const sessionService = require('../src/services/liveOralSessionService');
const accessService = require('../src/services/liveOralAccessService');
const evaluationService = require('../src/services/liveOralEvaluationService');

test('Phase 3 — évaluations orales en visioconférence', async t => {
  const key = `${Date.now()}${process.pid}`;
  const users = [];
  let course;
  const createUser = async (suffix, role) => {
    const user = await prisma.user.create({
      data: { firstName: 'Live', lastName: suffix, phoneNumber: `+24388${key.slice(-7)}${users.length}`, passwordHash: 'test', role },
    });
    users.push(user.id);
    return user;
  };
  try {
    const admin = await createUser('Admin', 'ADMIN');
    const teacher = await createUser('Teacher', 'TEACHER');
    const outsider = await createUser('Outsider', 'TEACHER');
    const student = await createUser('Student', 'STUDENT');
    const other = await createUser('Other', 'STUDENT');
    course = await prisma.course.create({ data: { title: `Live ${key}`, slug: `live-${key}` } });
    const training = await prisma.trainingSession.create({
      data: {
        name: 'Cohorte live', courseId: course.id, startDate: new Date('2026-01-01'),
        endDate: new Date('2027-12-31'), registrationDeadline: new Date('2026-01-01'),
        capacity: 10, status: 'ONGOING',
      },
    });
    await prisma.trainingSessionTeacher.create({ data: { trainingSessionId: training.id, teacherId: teacher.id } });
    const enrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: training.id, status: 'CONFIRMED' } });
    const otherEnrollment = await prisma.enrollment.create({ data: { userId: other.id, trainingSessionId: training.id, status: 'CONFIRMED' } });
    const assessment = await assessmentService.create({
      title: `Oral live ${key}`, instructions: 'Présentez-vous clairement.', courseId: course.id,
      trainingSessionId: training.id, totalPoints: 20, passingScore: 10,
      criteria: [
        { code: 'FLUENCY', label: 'Fluidité', weight: 50, maxScore: 10, position: 1 },
        { code: 'ACCURACY', label: 'Précision', weight: 50, maxScore: 10, position: 2 },
      ],
    }, admin.id);
    await assessmentService.publish(assessment.id, admin.id);
    const start = new Date(Date.now() + 2 * 60 * 60000);
    const end = new Date(start.getTime() + 30 * 60000);
    const payload = {
      assessmentId: assessment.id, trainingSessionId: training.id,
      scheduledStartAt: start, scheduledEndAt: end, meetingPlatform: 'JITSI',
      privateMeetingUrl: 'https://meet.jit.si/private-secret-room', accessBeforeMinutes: 180,
      participants: [{ enrollmentId: enrollment.id, role: 'CANDIDATE' }],
      examiners: [{ teacherId: teacher.id, role: 'LEAD' }],
    };
    let live;

    await t.test('planifie, affecte et ne divulgue jamais le lien dans les listes', async () => {
      live = await sessionService.create(payload, admin.id);
      assert.equal(live.meetingPlatform, 'JITSI');
      const [studentRows, teacherRows, adminRows] = await Promise.all([
        accessService.studentList(student.id), accessService.teacherList(teacher.id), sessionService.listForAdmin(),
      ]);
      assert.equal('privateMeetingUrl' in studentRows.find(row => row.id === live.id), false);
      assert.equal('privateMeetingUrl' in teacherRows.find(row => row.id === live.id), false);
      assert.equal('privateMeetingUrl' in adminRows.find(row => row.id === live.id), false);
      await assert.rejects(() => accessService.studentDetail(other.id, live.id), error => error.code === 'SESSION_NOT_FOUND');
      await assert.rejects(() => accessService.requireExaminer(outsider.id, live.id), error => error.code === 'ACCESS_DENIED');
    });

    await t.test('détecte les conflits sans bloquer deux créneaux adjacents', async () => {
      await assert.rejects(
        () => sessionService.create({ ...payload, scheduledStartAt: new Date(start.getTime() + 1000), scheduledEndAt: end }, admin.id),
        error => error.code === 'PARTICIPANT_SCHEDULE_CONFLICT',
      );
      const adjacent = await sessionService.create({
        ...payload, scheduledStartAt: end, scheduledEndAt: new Date(end.getTime() + 30 * 60000),
        participants: [{ enrollmentId: otherEnrollment.id }],
      }, admin.id);
      assert.ok(adjacent.id);
    });

    await t.test('contrôle la fenêtre et l’identité avant de révéler le lien', async () => {
      await assert.rejects(() => accessService.studentJoin(student.id, live.id, new Date(start.getTime() - 181 * 60000)), error => error.code === 'SESSION_TOO_EARLY');
      assert.equal(await accessService.studentJoin(student.id, live.id, start), payload.privateMeetingUrl);
      assert.equal(await accessService.teacherJoin(teacher.id, live.id, start), payload.privateMeetingUrl);
      await assert.rejects(() => accessService.studentJoin(other.id, live.id, start), error => error.code === 'SESSION_NOT_FOUND');
      await assert.rejects(() => accessService.studentJoin(student.id, live.id, new Date(end.getTime() + 1000)), error => error.code === 'SESSION_TOO_LATE');
    });

    await t.test('présence, incident technique et fin ne génèrent aucune note', async () => {
      await accessService.transition(teacher.id, live.id, 'IN_PROGRESS', start);
      const participant = (await accessService.requireExaminer(teacher.id, live.id)).participants[0];
      await accessService.recordAttendance(teacher.id, live.id, { participantId: participant.id, status: 'TECHNICAL_ISSUE', notes: 'Micro indisponible.' });
      assert.equal((await prisma.liveOralSession.findUnique({ where: { id: live.id } })).status, 'IN_PROGRESS');
      await accessService.recordAttendance(teacher.id, live.id, { participantId: participant.id, status: 'PRESENT' });
      await accessService.transition(teacher.id, live.id, 'COMPLETED', end);
      assert.equal(await prisma.assessmentEvaluation.count({ where: { liveOralSessionId: live.id } }), 0);
      await assert.rejects(() => accessService.transition(teacher.id, live.id, 'COMPLETED', end), error => ['INVALID_TRANSITION', 'INVALID_STATUS_TRANSITION', 'STATUS_CONFLICT'].includes(error.code));
    });

    let evaluation;
    await t.test('note manuellement, masque le brouillon puis publie une seule fois', async () => {
      evaluation = await evaluationService.saveDraft(teacher.id, live.id, enrollment.id, {
        scores: [
          { criterionId: assessment.criteria[0].id, score: 8 },
          { criterionId: assessment.criteria[1].id, score: 7 },
        ],
        decision: 'PASSED', feedback: 'Bon oral.',
      });
      assert.equal(Number(evaluation.overallScore), 15);
      assert.equal((await accessService.studentDetail(student.id, live.id)).evaluations.length, 0);
      await assert.rejects(() => evaluationService.saveDraft(outsider.id, live.id, enrollment.id, { scores: [] }), error => error.code === 'ACCESS_DENIED');
      await evaluationService.publish(teacher.id, evaluation.id);
      await evaluationService.publish(teacher.id, evaluation.id);
      assert.equal((await accessService.studentDetail(student.id, live.id)).evaluations[0].decision, 'PASSED');
      assert.equal(await prisma.notification.count({ where: { type: 'LIVE_ORAL_RESULT_PUBLISHED', relatedId: evaluation.id } }), 1);
      await assert.rejects(() => evaluationService.saveDraft(teacher.id, live.id, enrollment.id, { scores: [] }), error => error.code === 'EVALUATION_LOCKED');
    });

    await t.test('notifications et rappels ne contiennent aucun secret de réunion', async () => {
      const rows = await prisma.notification.findMany({ where: { relatedEntity: 'LIVE_ORAL_SESSION', relatedId: live.id } });
      assert.ok(rows.length);
      assert.ok(rows.every(row => !`${row.message} ${row.actionUrl}`.includes('private-secret-room')));
      const reminders = await prisma.scheduledReminder.findMany({ where: { relatedEntity: 'LIVE_ORAL_SESSION', relatedId: live.id } });
      assert.ok(reminders.length);
      assert.ok(reminders.every(row => !`${row.message} ${row.actionUrl}`.includes('private-secret-room')));
    });

    await t.test('reporte en conservant l’historique puis annule avec motif', async () => {
      const originalStart = new Date(start.getTime() + 2 * 86400000);
      const original = await sessionService.create({
        ...payload,
        scheduledStartAt: originalStart,
        scheduledEndAt: new Date(originalStart.getTime() + 30 * 60000),
        participants: [{ enrollmentId: otherEnrollment.id }],
      }, admin.id);
      const replacementStart = new Date(originalStart.getTime() + 86400000);
      const replacement = await sessionService.reschedule(original.id, admin.id, {
        scheduledStartAt: replacementStart,
        scheduledEndAt: new Date(replacementStart.getTime() + 30 * 60000),
        reason: 'Indisponibilité exceptionnelle du jury.',
      });
      const old = await prisma.liveOralSession.findUnique({ where: { id: original.id } });
      assert.equal(old.status, 'RESCHEDULED');
      assert.equal(replacement.rescheduledFromId, original.id);
      await assert.rejects(() => accessService.studentJoin(other.id, original.id, originalStart), error => error.code === 'SESSION_UNAVAILABLE');
      assert.equal(await prisma.scheduledReminder.count({ where: { relatedEntity: 'LIVE_ORAL_SESSION', relatedId: original.id, status: 'PENDING' } }), 0);
      await sessionService.cancel(replacement.id, admin.id, 'Session annulée à la demande du centre.');
      const cancelled = await prisma.liveOralSession.findUnique({ where: { id: replacement.id } });
      assert.equal(cancelled.status, 'CANCELLED');
      assert.match(cancelled.cancellationReason, /demande du centre/);
      await assert.rejects(() => accessService.studentJoin(other.id, replacement.id, replacementStart), error => error.code === 'SESSION_UNAVAILABLE');
    });
  } finally {
    if (course) {
      const liveIds = (await prisma.liveOralSession.findMany({ where: { trainingSession: { courseId: course.id } }, select: { id: true } })).map(x => x.id);
      await prisma.notification.deleteMany({ where: { OR: [{ relatedEntity: 'LIVE_ORAL_SESSION', relatedId: { in: liveIds } }, { userId: { in: users } }] } }).catch(() => {});
      await prisma.scheduledReminder.deleteMany({ where: { relatedEntity: 'LIVE_ORAL_SESSION', relatedId: { in: liveIds } } }).catch(() => {});
      await prisma.assessmentEvaluation.deleteMany({ where: { assessment: { courseId: course.id } } }).catch(() => {});
      await prisma.liveOralAttendance.deleteMany({ where: { liveOralSessionId: { in: liveIds } } }).catch(() => {});
      await prisma.oralSessionEvent.deleteMany({ where: { liveOralSessionId: { in: liveIds } } }).catch(() => {});
      await prisma.liveOralParticipant.deleteMany({ where: { liveOralSessionId: { in: liveIds } } }).catch(() => {});
      await prisma.liveOralExaminer.deleteMany({ where: { liveOralSessionId: { in: liveIds } } }).catch(() => {});
      await prisma.liveOralSession.deleteMany({ where: { id: { in: liveIds } } }).catch(() => {});
      await prisma.assessment.deleteMany({ where: { courseId: course.id } }).catch(() => {});
      await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
  }
});
