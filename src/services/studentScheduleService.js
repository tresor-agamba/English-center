const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');

const ACTIVE_ENROLLMENT_STATUSES = ['TRIAL_ACTIVE', 'PAYMENT_REQUIRED', 'CONFIRMED', 'PAYMENT_FAILED'];

function accessPresentation(meeting, trialAccess, now = new Date()) {
  return trialAccessService.evaluateMeetingAccess(meeting, trialAccess, now);
}

async function getStudentMeetings(userId, { enrollmentId, courseEnrollmentId, period = 'all', limit } = {}) {
  const now = new Date();
  const where = {
    userId,
    status: { in: ACTIVE_ENROLLMENT_STATUSES },
    ...(enrollmentId ? { id: enrollmentId } : {}),
    ...(courseEnrollmentId ? { id: courseEnrollmentId } : {}),
  };
  const enrollments = await prisma.enrollment.findMany({
    where,
    select: {
      id: true,
      status: true,
      trainingSession: {
        select: {
          id: true,
          name: true,
          platform: true,
          timezone: true,
          course: { select: { id: true, title: true } },
          classMeetings: {
            orderBy: { startsAt: 'asc' },
            select: {
              id: true, title: true, startsAt: true, endsAt: true, status: true, platform: true,
              lesson: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });

  const accessEntries = await Promise.all(
    enrollments.map(async (enrollment) => [enrollment.id, await trialAccessService.calculateTrialAccess(enrollment.id)])
  );
  const accessByEnrollment = new Map(accessEntries);
  let meetings = enrollments.flatMap((enrollment) => {
    let levelPosition = 0;
    return enrollment.trainingSession.classMeetings.map((meeting) => ({
      ...meeting,
      levelPosition: meeting.status === 'CANCELLED' ? null : (levelPosition += 1),
      enrollmentId: enrollment.id,
      enrollmentStatus: enrollment.status,
      session: {
        id: enrollment.trainingSession.id,
        name: enrollment.trainingSession.name,
        platform: meeting.platform,
        timezone: enrollment.trainingSession.timezone,
      },
      course: enrollment.trainingSession.course,
      lesson: meeting.lesson,
      access: accessPresentation(meeting, accessByEnrollment.get(enrollment.id), now),
    })).filter((meeting) => meeting.status === 'SCHEDULED' && meeting.endsAt >= now);
  });

  if (period === 'week') {
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    meetings = meetings.filter((meeting) => meeting.startsAt <= end);
  } else if (period === 'month') {
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    meetings = meetings.filter((meeting) => meeting.startsAt < end);
  }
  meetings.sort((a, b) => a.startsAt - b.startsAt);
  return limit ? meetings.slice(0, limit) : meetings;
}

function groupMeetingsByDate(meetings) {
  const groups = new Map();
  for (const meeting of meetings) {
    const key = meeting.startsAt.toLocaleDateString('fr-FR', { timeZone: meeting.session.timezone });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(meeting);
  }
  return [...groups].map(([date, items]) => ({ date, meetings: items }));
}

module.exports = { ACTIVE_ENROLLMENT_STATUSES, accessPresentation, getStudentMeetings, groupMeetingsByDate };
