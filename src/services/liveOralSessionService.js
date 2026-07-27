const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const validation = require('./assessmentValidationService');
const { zonedDateTimeToUtc } = require('../utils/timezone.util');
const events = require('./liveOralNotificationService');

const ACTIVE_SESSION_STATUSES = ['SCHEDULED', 'READY', 'IN_PROGRESS'];
const PARTICIPANT_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];
const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'TECHNICAL_ISSUE'];
const EXAMINER_ROLES = ['LEAD', 'EXAMINER', 'JURY'];
const PARTICIPANT_ROLES = ['CANDIDATE', 'PARTNER'];

function collection(value, label) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new validation.AssessmentValidationError('INVALID_COLLECTION', `${label} sont invalides.`);
}

function uniqueAssignments(value, roleValues, label) {
  const rows = collection(value, label).map(item => {
    const id = validation.parseId(item.id ?? item.enrollmentId ?? item.teacherId, label.slice(0, -1));
    const role = String(item.role || roleValues[0]).toUpperCase();
    if (!roleValues.includes(role)) throw new validation.AssessmentValidationError('INVALID_ROLE', `Rôle de ${label.toLowerCase()} invalide.`);
    return { id, role };
  });
  if (!rows.length) throw new validation.AssessmentValidationError('ASSIGNMENTS_REQUIRED', `Au moins un élément est requis pour ${label.toLowerCase()}.`);
  if (new Set(rows.map(item => item.id)).size !== rows.length) {
    throw new validation.AssessmentValidationError('DUPLICATE_ASSIGNMENT', `${label} ne peuvent pas contenir de doublon.`);
  }
  return rows;
}

function scheduleDates(body, timezone) {
  let start;
  let end;
  if (body.date && body.startTime && body.endTime) {
    start = zonedDateTimeToUtc(body.date, body.startTime, timezone);
    end = zonedDateTimeToUtc(body.date, body.endTime, timezone);
  } else {
    start = validation.parseOptionalDate(body.scheduledStartAt, 'La date de début');
    end = validation.parseOptionalDate(body.scheduledEndAt, 'La date de fin');
  }
  if (!start || !end) throw new validation.AssessmentValidationError('INVALID_SCHEDULE', 'Le créneau est invalide.');
  validation.validateDateRange(start, end, ['Le début', 'La fin']);
  return { start, end };
}

async function requirePlanner(actorId, trainingSessionId, client = prisma) {
  const actor = await client.user.findUnique({
    where: { id: validation.parseId(actorId, 'acteur') },
    select: { id: true, role: true, isActive: true },
  });
  if (!actor?.isActive || !['ADMIN', 'TEACHER'].includes(actor.role)) {
    throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Accès interdit.', 403);
  }
  if (actor.role === 'TEACHER') {
    const assignment = await client.trainingSessionTeacher.findUnique({
      where: { trainingSessionId_teacherId: { trainingSessionId, teacherId: actor.id } },
      select: { id: true },
    });
    if (!assignment) throw new validation.AssessmentValidationError('ACCESS_DENIED', 'Vous n’êtes pas autorisé à planifier cette session.', 403);
  }
  return actor;
}

async function buildData(body, actorId, client = prisma, excludedSessionId = null) {
  const assessmentId = validation.parseId(body.assessmentId, 'évaluation');
  const trainingSessionId = validation.parseId(body.trainingSessionId, 'session de formation');
  const [assessment, trainingSession] = await Promise.all([
    client.assessment.findUnique({
      where: { id: assessmentId },
      include: { criteria: true },
    }),
    client.trainingSession.findUnique({
      where: { id: trainingSessionId },
      select: { id: true, courseId: true, timezone: true, teachers: { select: { teacherId: true } } },
    }),
  ]);
  if (!assessment || assessment.mode !== 'LIVE_VIDEO_ORAL' || assessment.status !== 'PUBLISHED') {
    throw new validation.AssessmentValidationError('ASSESSMENT_UNAVAILABLE', 'L’évaluation en direct n’est pas publiée.', 404);
  }
  if (!trainingSession || trainingSession.courseId !== assessment.courseId
      || (assessment.trainingSessionId && assessment.trainingSessionId !== trainingSession.id)) {
    throw new validation.AssessmentValidationError('SESSION_COURSE_MISMATCH', 'La session ne correspond pas à l’évaluation.');
  }
  await requirePlanner(actorId, trainingSession.id, client);
  const { start, end } = scheduleDates(body, trainingSession.timezone);
  if ((assessment.openAt && start < assessment.openAt) || (assessment.closeAt && end > assessment.closeAt)) {
    throw new validation.AssessmentValidationError('OUTSIDE_ASSESSMENT_WINDOW', 'Le créneau doit rester dans la période de l’évaluation.');
  }
  const participants = uniqueAssignments(body.participants, PARTICIPANT_ROLES, 'Participants');
  const examiners = uniqueAssignments(body.examiners, EXAMINER_ROLES, 'Examinateurs');
  const validEnrollments = await client.enrollment.findMany({
    where: { id: { in: participants.map(item => item.id) }, trainingSessionId, status: { in: PARTICIPANT_STATUSES } },
    select: { id: true },
  });
  if (validEnrollments.length !== participants.length) {
    throw new validation.AssessmentValidationError('INVALID_PARTICIPANT', 'Un participant n’est pas inscrit à cette session.');
  }
  const allowedTeacherIds = new Set(trainingSession.teachers.map(item => item.teacherId));
  if (examiners.some(item => !allowedTeacherIds.has(item.id))) {
    throw new validation.AssessmentValidationError('INVALID_EXAMINER', 'Un examinateur n’est pas affecté à cette session.');
  }
  const overlap = { scheduledStartAt: { lt: end }, scheduledEndAt: { gt: start }, status: { in: ACTIVE_SESSION_STATUSES } };
  const [participantConflict, examinerConflict] = await Promise.all([
    client.liveOralSession.findFirst({
      where: {
        ...overlap,
        ...(excludedSessionId ? { id: { not: excludedSessionId } } : {}),
        participants: { some: { enrollmentId: { in: participants.map(item => item.id) } } },
      },
      select: { id: true },
    }),
    client.liveOralSession.findFirst({
      where: {
        ...overlap,
        ...(excludedSessionId ? { id: { not: excludedSessionId } } : {}),
        examiners: { some: { teacherId: { in: examiners.map(item => item.id) } } },
      },
      select: { id: true },
    }),
  ]);
  if (participantConflict) throw new validation.AssessmentValidationError('PARTICIPANT_SCHEDULE_CONFLICT', 'Un participant a déjà un examen sur ce créneau.');
  if (examinerConflict) throw new validation.AssessmentValidationError('EXAMINER_SCHEDULE_CONFLICT', 'Un examinateur ou juré a déjà un examen sur ce créneau.');
  return {
    assessmentId,
    trainingSessionId,
    scheduledStartAt: start,
    scheduledEndAt: end,
    meetingPlatform: validation.normalizeMeetingPlatform(body.meetingPlatform),
    privateMeetingUrl: validation.validatePrivateMeetingUrl(body.privateMeetingUrl),
    meetingCode: validation.optionalText(body.meetingCode, 'Le code de réunion', 200),
    accessBeforeMinutes: validation.parseInteger(body.accessBeforeMinutes ?? 30, 'La fenêtre avant examen', { min: 0, max: 1440 }),
    accessAfterMinutes: validation.parseInteger(body.accessAfterMinutes ?? 0, 'La fenêtre après examen', { min: 0, max: 1440 }),
    createdById: validation.parseId(actorId, 'créateur'),
    participants,
    examiners,
  };
}

async function create(body, actorId) {
  let result;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      result = await prisma.$transaction(async tx => {
        const data = await buildData(body, actorId, tx);
        return tx.liveOralSession.create({
          data: {
            assessmentId: data.assessmentId,
            trainingSessionId: data.trainingSessionId,
            scheduledStartAt: data.scheduledStartAt,
            scheduledEndAt: data.scheduledEndAt,
            meetingPlatform: data.meetingPlatform,
            privateMeetingUrl: data.privateMeetingUrl,
            meetingCode: data.meetingCode,
            accessBeforeMinutes: data.accessBeforeMinutes,
            accessAfterMinutes: data.accessAfterMinutes,
            createdById: data.createdById,
            participants: { create: data.participants.map(item => ({ enrollmentId: item.id, role: item.role })) },
            examiners: { create: data.examiners.map(item => ({ teacherId: item.id, role: item.role })) },
            events: { create: { actorId: data.createdById, action: 'CREATED', toStatus: 'SCHEDULED' } },
          },
          select: { id: true, status: true },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (error.code !== 'P2034' || retry === 2) throw error;
    }
  }
  await events.notifyScheduled(result.id);
  return getAdminDetail(result.id, actorId);
}

async function getAdminDetail(value, actorId, client = prisma) {
  const session = await client.liveOralSession.findUnique({
    where: { id: validation.parseId(value, 'session orale') },
    include: {
      assessment: { include: { course: true, criteria: { orderBy: { position: 'asc' } } } },
      trainingSession: true,
      participants: { include: { enrollment: { include: { user: { select: { firstName: true, lastName: true } } } }, attendance: true } },
      examiners: { include: { teacher: { select: { firstName: true, lastName: true } } } },
      events: { orderBy: { createdAt: 'desc' } },
      evaluations: true,
    },
  });
  if (!session) throw new validation.AssessmentValidationError('SESSION_NOT_FOUND', 'Session orale introuvable.', 404);
  await requirePlanner(actorId, session.trainingSessionId, client);
  return session;
}

function listForAdmin() {
  return prisma.liveOralSession.findMany({
    select: {
      id: true, scheduledStartAt: true, scheduledEndAt: true, meetingPlatform: true, status: true,
      assessment: { select: { title: true, course: { select: { title: true } } } },
      trainingSession: { select: { name: true } },
      _count: { select: { participants: true, examiners: true } },
    },
    orderBy: { scheduledStartAt: 'asc' },
  });
}

async function cancel(value, actorId, reasonValue) {
  const reason = validation.requiredText(reasonValue, 'Le motif d’annulation', 2000);
  const result = await prisma.$transaction(async tx => {
    const session = await getAdminDetail(value, actorId, tx);
    validation.validateLiveOralTransition(session.status, 'CANCELLED');
    const updated = await tx.liveOralSession.updateMany({
      where: { id: session.id, status: session.status },
      data: { status: 'CANCELLED', cancelledById: actorId, cancelledAt: new Date(), cancellationReason: reason },
    });
    if (updated.count !== 1) throw new validation.AssessmentValidationError('STATUS_CONFLICT', 'La session a déjà été modifiée.', 409);
    await tx.oralSessionEvent.create({ data: { liveOralSessionId: session.id, actorId, action: 'CANCELLED', fromStatus: session.status, toStatus: 'CANCELLED', reason } });
    return session.id;
  });
  await events.notifyCancelled(result);
  return prisma.liveOralSession.findUnique({ where: { id: result } });
}

async function reschedule(value, actorId, body) {
  const reason = validation.requiredText(body.reason, 'Le motif du report', 2000);
  const ids = await prisma.$transaction(async tx => {
    const old = await getAdminDetail(value, actorId, tx);
    validation.validateLiveOralTransition(old.status, 'RESCHEDULED');
    const data = await buildData({
      ...body,
      assessmentId: old.assessmentId,
      trainingSessionId: old.trainingSessionId,
      participants: old.participants.map(item => ({ enrollmentId: item.enrollmentId, role: item.role })),
      examiners: old.examiners.map(item => ({ teacherId: item.teacherId, role: item.role })),
      meetingPlatform: body.meetingPlatform || old.meetingPlatform,
      privateMeetingUrl: body.privateMeetingUrl || old.privateMeetingUrl,
      meetingCode: body.meetingCode ?? old.meetingCode,
      accessBeforeMinutes: body.accessBeforeMinutes ?? old.accessBeforeMinutes,
      accessAfterMinutes: body.accessAfterMinutes ?? old.accessAfterMinutes,
    }, actorId, tx, old.id);
    const now = new Date();
    const changed = await tx.liveOralSession.updateMany({
      where: { id: old.id, status: old.status },
      data: { status: 'RESCHEDULED', rescheduledById: actorId, rescheduledAt: now, rescheduleReason: reason },
    });
    if (changed.count !== 1) throw new validation.AssessmentValidationError('STATUS_CONFLICT', 'La session a déjà été modifiée.', 409);
    const replacement = await tx.liveOralSession.create({
      data: {
        assessmentId: data.assessmentId, trainingSessionId: data.trainingSessionId,
        scheduledStartAt: data.scheduledStartAt, scheduledEndAt: data.scheduledEndAt,
        meetingPlatform: data.meetingPlatform, privateMeetingUrl: data.privateMeetingUrl, meetingCode: data.meetingCode,
        accessBeforeMinutes: data.accessBeforeMinutes, accessAfterMinutes: data.accessAfterMinutes,
        createdById: actorId, rescheduledFromId: old.id, rescheduledById: actorId, rescheduledAt: now, rescheduleReason: reason,
        participants: { create: data.participants.map(item => ({ enrollmentId: item.id, role: item.role })) },
        examiners: { create: data.examiners.map(item => ({ teacherId: item.id, role: item.role })) },
        events: { create: { actorId, action: 'CREATED_BY_RESCHEDULE', toStatus: 'SCHEDULED', reason } },
      },
    });
    await tx.oralSessionEvent.create({ data: { liveOralSessionId: old.id, actorId, action: 'RESCHEDULED', fromStatus: old.status, toStatus: 'RESCHEDULED', reason } });
    return { oldId: old.id, newId: replacement.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await events.notifyRescheduled(ids.oldId, ids.newId);
  return getAdminDetail(ids.newId, actorId);
}

module.exports = {
  ACTIVE_SESSION_STATUSES,
  PARTICIPANT_STATUSES,
  ATTENDANCE_STATUSES,
  EXAMINER_ROLES,
  PARTICIPANT_ROLES,
  collection,
  uniqueAssignments,
  scheduleDates,
  requirePlanner,
  buildData,
  create,
  getAdminDetail,
  listForAdmin,
  cancel,
  reschedule,
};
