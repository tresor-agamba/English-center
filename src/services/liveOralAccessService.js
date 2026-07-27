const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const sessionService = require('./liveOralSessionService');

function accessWindow(session, now = new Date()) {
  const opensAt = new Date(session.scheduledStartAt.getTime() - session.accessBeforeMinutes * 60000);
  const closesAt = new Date(session.scheduledEndAt.getTime() + session.accessAfterMinutes * 60000);
  return { opensAt, closesAt, isOpen: now >= opensAt && now <= closesAt };
}

function assertJoinable(session, now = new Date()) {
  if (!['SCHEDULED', 'READY', 'IN_PROGRESS'].includes(session.status)) {
    throw new validation.AssessmentValidationError('SESSION_UNAVAILABLE', 'Cette session orale n’est pas accessible.', 403);
  }
  const window = accessWindow(session, now);
  if (now < window.opensAt) throw new validation.AssessmentValidationError('SESSION_TOO_EARLY', 'La fenêtre d’accès n’est pas encore ouverte.', 403);
  if (now > window.closesAt) throw new validation.AssessmentValidationError('SESSION_TOO_LATE', 'La fenêtre d’accès est fermée.', 403);
  return window;
}

function studentList(studentId) {
  return prisma.liveOralSession.findMany({
    where: { participants: { some: { enrollment: { userId: validation.parseId(studentId, 'étudiant') } } } },
    select: {
      id: true, scheduledStartAt: true, scheduledEndAt: true, meetingPlatform: true, status: true,
      accessBeforeMinutes: true, accessAfterMinutes: true,
      assessment: { select: { id: true, title: true, instructions: true } },
      trainingSession: { select: { name: true, timezone: true } },
      participants: { select: { role: true, enrollment: { select: { user: { select: { firstName: true, lastName: true } } } } } },
      evaluations: {
        where: { enrollment: { userId: studentId }, status: 'PUBLISHED' },
        select: { id: true, overallScore: true, decision: true, publishedAt: true },
      },
    },
    orderBy: { scheduledStartAt: 'asc' },
  });
}

async function studentDetail(studentId, value) {
  const session = await prisma.liveOralSession.findFirst({
    where: {
      id: validation.parseId(value, 'session orale'),
      participants: { some: { enrollment: { userId: validation.parseId(studentId, 'étudiant') } } },
    },
    select: {
      id: true, scheduledStartAt: true, scheduledEndAt: true, meetingPlatform: true, status: true,
      accessBeforeMinutes: true, accessAfterMinutes: true,
      assessment: { select: { id: true, title: true, instructions: true, totalPoints: true, passingScore: true } },
      trainingSession: { select: { name: true, timezone: true } },
      participants: { select: { role: true, enrollment: { select: { id: true, user: { select: { firstName: true, lastName: true } } } } } },
      examiners: { select: { role: true, teacher: { select: { firstName: true, lastName: true } } } },
      attendances: {
        where: { participant: { enrollment: { userId: studentId } } },
        select: { status: true, markedAt: true, notes: true },
      },
      evaluations: {
        where: { enrollment: { userId: studentId }, status: 'PUBLISHED' },
        include: { criterionScores: { orderBy: { assessmentCriterion: { position: 'asc' } } } },
      },
    },
  });
  if (!session) throw new validation.AssessmentValidationError('SESSION_NOT_FOUND', 'Session orale introuvable.', 404);
  return { ...session, access: accessWindow(session) };
}

async function studentJoin(studentId, value, now = new Date()) {
  const session = await prisma.liveOralSession.findFirst({
    where: {
      id: validation.parseId(value, 'session orale'),
      participants: {
        some: {
          enrollment: { userId: validation.parseId(studentId, 'étudiant'), status: { in: sessionService.PARTICIPANT_STATUSES } },
        },
      },
    },
    select: {
      id: true, scheduledStartAt: true, scheduledEndAt: true, accessBeforeMinutes: true, accessAfterMinutes: true,
      status: true, privateMeetingUrl: true,
    },
  });
  if (!session) throw new validation.AssessmentValidationError('SESSION_NOT_FOUND', 'Session orale introuvable.', 404);
  assertJoinable(session, now);
  return validation.validatePrivateMeetingUrl(session.privateMeetingUrl);
}

function teacherList(teacherId) {
  return prisma.liveOralSession.findMany({
    where: { examiners: { some: { teacherId: validation.parseId(teacherId, 'enseignant') } } },
    select: {
      id: true, scheduledStartAt: true, scheduledEndAt: true, meetingPlatform: true, status: true,
      accessBeforeMinutes: true, accessAfterMinutes: true,
      assessment: { select: { title: true } },
      trainingSession: { select: { name: true, timezone: true } },
      _count: { select: { participants: true, examiners: true } },
    },
    orderBy: { scheduledStartAt: 'asc' },
  });
}

async function requireExaminer(teacherId, value, { includePrivateUrl = false } = {}, client = prisma) {
  const session = await client.liveOralSession.findFirst({
    where: {
      id: validation.parseId(value, 'session orale'),
      examiners: { some: { teacherId: validation.parseId(teacherId, 'enseignant') } },
    },
    select: {
      id: true, assessmentId: true, trainingSessionId: true, scheduledStartAt: true, scheduledEndAt: true,
      meetingPlatform: true, status: true, accessBeforeMinutes: true, accessAfterMinutes: true,
      ...(includePrivateUrl ? { privateMeetingUrl: true } : {}),
      assessment: { include: { course: true, criteria: { orderBy: { position: 'asc' } } } },
      trainingSession: true,
      participants: { include: { enrollment: { include: { user: { select: { firstName: true, lastName: true } } } }, attendance: true } },
      examiners: { include: { teacher: { select: { firstName: true, lastName: true } } } },
      evaluations: { include: { criterionScores: true } },
    },
  });
  if (!session) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Session orale inaccessible.', 403);
  return session;
}

async function teacherJoin(teacherId, value, now = new Date()) {
  const session = await requireExaminer(teacherId, value, { includePrivateUrl: true });
  assertJoinable(session, now);
  return validation.validatePrivateMeetingUrl(session.privateMeetingUrl);
}

async function transition(teacherId, value, toStatus, now = new Date()) {
  return prisma.$transaction(async tx => {
    const session = await requireExaminer(teacherId, value, {}, tx);
    validation.validateLiveOralTransition(session.status, toStatus);
    if (toStatus === 'IN_PROGRESS') assertJoinable(session, now);
    const data = {
      status: toStatus,
      ...(toStatus === 'IN_PROGRESS' ? { startedAt: now } : {}),
      ...(toStatus === 'COMPLETED' ? { completedAt: now } : {}),
    };
    const updated = await tx.liveOralSession.updateMany({ where: { id: session.id, status: session.status }, data });
    if (updated.count !== 1) throw new validation.AssessmentValidationError('STATUS_CONFLICT', 'La session a déjà été modifiée.', 409);
    await tx.oralSessionEvent.create({
      data: { liveOralSessionId: session.id, actorId: teacherId, action: toStatus === 'IN_PROGRESS' ? 'STARTED' : 'COMPLETED', fromStatus: session.status, toStatus },
    });
    return tx.liveOralSession.findUnique({ where: { id: session.id } });
  });
}

async function recordAttendance(teacherId, value, body) {
  const status = String(body.status || '').toUpperCase();
  if (!sessionService.ATTENDANCE_STATUSES.includes(status)) throw new validation.AssessmentValidationError('INVALID_ATTENDANCE', 'Statut de présence invalide.');
  const participantId = validation.parseId(body.participantId, 'participant');
  return prisma.$transaction(async tx => {
    const session = await requireExaminer(teacherId, value, {}, tx);
    if (['CANCELLED', 'RESCHEDULED'].includes(session.status)) throw new validation.AssessmentValidationError('SESSION_UNAVAILABLE', 'Cette session ne peut plus recevoir de présence.');
    const participant = session.participants.find(item => item.id === participantId);
    if (!participant) throw new validation.AssessmentValidationError('PARTICIPANT_NOT_FOUND', 'Participant introuvable.', 404);
    const attendance = await tx.liveOralAttendance.upsert({
      where: { liveOralParticipantId: participant.id },
      create: {
        liveOralSessionId: session.id, liveOralParticipantId: participant.id, status,
        markedByTeacherId: teacherId, markedAt: new Date(),
        notes: validation.optionalText(body.notes, 'La note de présence', 2000),
      },
      update: {
        status, markedByTeacherId: teacherId, markedAt: new Date(),
        notes: validation.optionalText(body.notes, 'La note de présence', 2000),
      },
    });
    await tx.oralSessionEvent.create({
      data: { liveOralSessionId: session.id, actorId: teacherId, action: `ATTENDANCE_${status}`, fromStatus: session.status, toStatus: session.status },
    });
    return attendance;
  });
}

module.exports = {
  accessWindow,
  assertJoinable,
  studentList,
  studentDetail,
  studentJoin,
  teacherList,
  requireExaminer,
  teacherJoin,
  transition,
  recordAttendance,
};
