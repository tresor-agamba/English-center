const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');

class StudentClassMeetingError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'StudentClassMeetingError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function getMeetingDetails(userId, value) {
  const meetingId = Number(value);
  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    throw new StudentClassMeetingError('INVALID_MEETING', 'Séance introuvable.', 404);
  }
  const meeting = await prisma.classMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true, title: true, startsAt: true, endsAt: true, status: true, platform: true, lessonId: true,
      trainingSession: {
        select: {
          id: true, name: true, timezone: true,
          course: { select: { id: true, title: true } },
          enrollments: {
            where: { userId },
            select: { id: true, status: true },
            take: 1,
          },
        },
      },
    },
  });
  const enrollment = meeting?.trainingSession.enrollments[0];
  if (!meeting || !enrollment) throw new StudentClassMeetingError('MEETING_NOT_FOUND', 'Séance introuvable.', 404);
  const trialAccess = await trialAccessService.calculateTrialAccess(enrollment.id);
  const orderedMeetings = await prisma.classMeeting.findMany({
    where: { trainingSessionId: meeting.trainingSession.id, status: { not: 'CANCELLED' } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const levelPosition = orderedMeetings.findIndex((item) => item.id === meeting.id) + 1;
  const access = trialAccessService.evaluateMeetingAccess({ ...meeting, levelPosition }, trialAccess);
  let lesson = null;
  if (meeting.lessonId && trialAccess.hasCourseAccess) {
    lesson = await prisma.courseLesson.findFirst({
      where: {
        id: meeting.lessonId, isPublished: true,
        courseModule: { isPublished: true, courseId: meeting.trainingSession.course.id },
      },
      select: {
        id: true, title: true, description: true,
        resources: {
          orderBy: { position: 'asc' },
          select: { id: true, title: true, type: true, url: true },
        },
      },
    });
  }
  return {
    meeting: {
      id: meeting.id, title: meeting.title, startsAt: meeting.startsAt, endsAt: meeting.endsAt,
      status: meeting.status, platform: meeting.platform, levelPosition,
    },
    session: {
      id: meeting.trainingSession.id, name: meeting.trainingSession.name,
      timezone: meeting.trainingSession.timezone,
    },
    course: meeting.trainingSession.course,
    enrollment,
    trialAccess,
    access,
    lesson,
  };
}

module.exports = { StudentClassMeetingError, getMeetingDetails };
