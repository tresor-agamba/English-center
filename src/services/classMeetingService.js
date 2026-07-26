const prisma = require('../utils/prisma');
const { OCCUPYING_ENROLLMENT_STATUSES } = require('./enrollmentPolicy');
const trialAccessService = require('./trialAccessService');
const { zonedDateTimeToUtc, dateKeyInZone } = require('../utils/timezone.util');

const MEETING_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'];
const MEETING_PLATFORMS = ['GOOGLE_MEET', 'ZOOM', 'MICROSOFT_TEAMS', 'OTHER'];
const JS_DAY_TO_WEEKDAY = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

class ClassMeetingError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'ClassMeetingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseId(value, label = 'Séance') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ClassMeetingError('INVALID_ID', `${label} invalide.`);
  return id;
}

function validateMeetingUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeMeetingPlatform(value) {
  const normalized = String(value || '').trim().toUpperCase().replaceAll(' ', '_');
  if (normalized.includes('GOOGLE')) return 'GOOGLE_MEET';
  if (normalized.includes('ZOOM')) return 'ZOOM';
  if (normalized.includes('TEAMS') || normalized.includes('MICROSOFT')) return 'MICROSOFT_TEAMS';
  return MEETING_PLATFORMS.includes(normalized) ? normalized : 'OTHER';
}

async function buildMeetingData(body, existingMeeting = null) {
  const trainingSessionId = parseId(body.trainingSessionId, 'Session');
  const session = await prisma.trainingSession.findUnique({
    where: { id: trainingSessionId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      weekDays: true,
      timezone: true,
      courseId: true,
      platform: true,
    },
  });
  if (!session) throw new ClassMeetingError('SESSION_NOT_FOUND', 'Session de formation introuvable.', 404);

  const lessonId = body.lessonId ? parseId(body.lessonId, 'Leçon') : null;
  if (lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { courseModule: { select: { courseId: true } } },
    });
    if (!lesson || lesson.courseModule.courseId !== session.courseId) {
      throw new ClassMeetingError('LESSON_COURSE_MISMATCH', 'La leçon n’appartient pas à la formation de cette session.');
    }
  }

  const date = body.date?.trim() || '';
  const startTime = body.startTime?.trim() || '';
  const endTime = body.endTime?.trim() || '';
  const startsAt = zonedDateTimeToUtc(date, startTime, session.timezone);
  const endsAt = zonedDateTimeToUtc(date, endTime, session.timezone);
  if (!startsAt || !endsAt) throw new ClassMeetingError('INVALID_DATE', 'Date ou horaires invalides.');
  if (endsAt <= startsAt) throw new ClassMeetingError('INVALID_TIME_RANGE', "L'heure de fin doit être postérieure à l'heure de début.");

  const sessionStart = dateKeyInZone(session.startDate, session.timezone);
  const sessionEnd = dateKeyInZone(session.endDate, session.timezone);
  if (date < sessionStart || date > sessionEnd) {
    throw new ClassMeetingError('OUTSIDE_SESSION', 'La date doit être comprise dans la période de la session.');
  }
  const weekDay = JS_DAY_TO_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
  if (!session.weekDays.includes(weekDay)) {
    throw new ClassMeetingError('INVALID_WEEKDAY', 'Ce jour ne fait pas partie des jours de cours configurés.');
  }

  const privateMeetingUrl = body.privateMeetingUrl?.trim() || '';
  if (!validateMeetingUrl(privateMeetingUrl)) {
    throw new ClassMeetingError('INVALID_URL', 'Le lien de réunion doit être une URL HTTP ou HTTPS valide.');
  }
  const platform = body.platform
    ? String(body.platform).trim().toUpperCase().replaceAll(' ', '_')
    : normalizeMeetingPlatform(session.platform);
  if (!MEETING_PLATFORMS.includes(platform)) throw new ClassMeetingError('INVALID_PLATFORM', 'Plateforme de réunion invalide.');
  const status = body.status;
  if (!MEETING_STATUSES.includes(status)) throw new ClassMeetingError('INVALID_STATUS', 'Statut de séance invalide.');

  if (existingMeeting && existingMeeting.trainingSessionId !== trainingSessionId && existingMeeting._count.attendances > 0) {
    throw new ClassMeetingError('SESSION_CHANGE_FORBIDDEN', 'Impossible de changer la session d’une séance possédant des présences.');
  }
  if (existingMeeting?.status === 'COMPLETED' && existingMeeting._count.attendances > 0) {
    const scheduleChanged =
      existingMeeting.trainingSessionId !== trainingSessionId ||
      existingMeeting.startsAt.getTime() !== startsAt.getTime() ||
      existingMeeting.endsAt.getTime() !== endsAt.getTime();
    if (scheduleChanged) {
      throw new ClassMeetingError('COMPLETED_MEETING_LOCKED', 'Les horaires d’une séance terminée avec présences ne peuvent pas être déplacés.');
    }
  }

  const duplicate = await prisma.classMeeting.findFirst({
    where: {
      trainingSessionId,
      startsAt,
      ...(existingMeeting ? { id: { not: existingMeeting.id } } : {}),
    },
    select: { id: true },
  });
  if (duplicate) throw new ClassMeetingError('DUPLICATE_MEETING', 'Une séance existe déjà à cette date et cette heure.');

  return {
    trainingSessionId,
    title: body.title?.trim().slice(0, 160) || null,
    startsAt,
    endsAt,
    privateMeetingUrl,
    platform,
    lessonId,
    status,
  };
}

function list(filters = {}) {
  const where = {};
  if (filters.courseId) where.trainingSession = { courseId: filters.courseId };
  if (filters.trainingSessionId) where.trainingSessionId = filters.trainingSessionId;
  if (filters.status) where.status = filters.status;
  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) where.startsAt = { gte: start, lt: new Date(start.getTime() + 86400000) };
  }
  return prisma.classMeeting.findMany({
    where,
    orderBy: { startsAt: 'asc' },
    include: {
      trainingSession: { include: { course: true } },
      lesson: { select: { id: true, title: true } },
      _count: { select: { attendances: true } },
    },
  });
}

function listSessions() {
  return prisma.trainingSession.findMany({
    orderBy: { startDate: 'desc' },
    include: { course: { select: { id: true, title: true } } },
  });
}

function listCourses() {
  return prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true } });
}

async function listLessonsForSession(value) {
  if (!value) return [];
  const sessionId = parseId(value, 'Session');
  const session = await prisma.trainingSession.findUnique({ where: { id: sessionId }, select: { courseId: true } });
  if (!session) return [];
  return prisma.lesson.findMany({
    where: { courseModule: { courseId: session.courseId } },
    orderBy: [{ courseModule: { position: 'asc' } }, { position: 'asc' }],
    select: { id: true, title: true, courseModule: { select: { title: true } } },
  });
}

function listLessonsCatalog() {
  return prisma.lesson.findMany({
    orderBy: [{ courseModule: { position: 'asc' } }, { position: 'asc' }],
    select: { id: true, title: true, courseModule: { select: { title: true, courseId: true } } },
  });
}

function findById(id) {
  return prisma.classMeeting.findUnique({
    where: { id },
    include: {
      trainingSession: { include: { course: true }, },
      lesson: {
        include: {
          courseModule: true,
          resources: { orderBy: { position: 'asc' } },
        },
      },
      attendances: { select: { status: true } },
      _count: { select: { attendances: true } },
    },
  });
}

async function getAttendanceSheet(id) {
  const meeting = await findById(id);
  if (!meeting) throw new ClassMeetingError('MEETING_NOT_FOUND', 'Séance introuvable.', 404);
  const enrollments = await prisma.enrollment.findMany({
    where: {
      trainingSessionId: meeting.trainingSessionId,
      status: { in: OCCUPYING_ENROLLMENT_STATUSES },
    },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
    select: {
      id: true,
      status: true,
      user: { select: { firstName: true, lastName: true, phoneNumber: true } },
      attendances: {
        where: { classMeetingId: meeting.id },
        select: { status: true },
      },
    },
  });
  const rows = await Promise.all(enrollments.map(async (enrollment) => ({
    ...enrollment,
    currentAttendanceStatus: enrollment.attendances[0]?.status || '',
    trialAccess: await trialAccessService.calculateTrialAccess(enrollment.id),
  })));
  return { meeting, rows };
}

function create(data) {
  return prisma.classMeeting.create({ data });
}

function update(id, data) {
  return prisma.classMeeting.update({ where: { id }, data });
}

function cancel(id) {
  return prisma.$transaction(async (tx) => {
    const meeting = await tx.classMeeting.update({
      where: { id },
      data: { status: 'CANCELLED' },
      select: { id: true, attendances: { select: { enrollmentId: true } } },
    });
    const enrollmentIds = [...new Set(meeting.attendances.map((attendance) => attendance.enrollmentId))];
    for (const enrollmentId of enrollmentIds) await trialAccessService.calculateTrialAccess(enrollmentId, tx);
    return meeting;
  });
}

module.exports = {
  MEETING_STATUSES,
  MEETING_PLATFORMS,
  ClassMeetingError,
  parseId,
  validateMeetingUrl,
  normalizeMeetingPlatform,
  buildMeetingData,
  list,
  listSessions,
  listCourses,
  listLessonsForSession,
  listLessonsCatalog,
  findById,
  getAttendanceSheet,
  create,
  update,
  cancel,
};
