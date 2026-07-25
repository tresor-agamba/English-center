const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');

const ACTIVE_ENROLLMENT_STATUSES = ['TRIAL_ACTIVE', 'PAYMENT_REQUIRED', 'CONFIRMED', 'PAYMENT_FAILED'];

function accessPresentation(meeting, trialAccess, now = new Date()) {
  if (meeting.status === 'CANCELLED') return { code: 'CANCELLED', label: 'Annulée', canJoin: false };
  if (meeting.endsAt < now) return { code: 'ENDED', label: 'Terminée', canJoin: false };
  if (!trialAccess.hasCourseAccess) {
    return { code: 'PAYMENT_REQUIRED', label: 'Accès bloqué — paiement requis', canJoin: false };
  }
  const opensAt = new Date(meeting.startsAt.getTime() - trialAccessService.CLASS_JOIN_EARLY_MINUTES * 60000);
  if (now >= opensAt && now <= meeting.endsAt) {
    return { code: 'OPEN', label: 'Accès ouvert', canJoin: true };
  }
  const minutes = Math.max(1, Math.ceil((opensAt.getTime() - now.getTime()) / 60000));
  if (minutes <= 120) return { code: 'SOON', label: `Accessible dans ${minutes} minutes`, canJoin: false };
  return { code: 'UPCOMING', label: 'À venir', canJoin: false };
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
            where: { status: 'SCHEDULED', endsAt: { gte: now } },
            orderBy: { startsAt: 'asc' },
            select: { id: true, title: true, startsAt: true, endsAt: true, status: true },
          },
        },
      },
    },
  });

  const accessEntries = await Promise.all(
    enrollments.map(async (enrollment) => [enrollment.id, await trialAccessService.calculateTrialAccess(enrollment.id)])
  );
  const accessByEnrollment = new Map(accessEntries);
  let meetings = enrollments.flatMap((enrollment) =>
    enrollment.trainingSession.classMeetings.map((meeting) => ({
      ...meeting,
      enrollmentId: enrollment.id,
      enrollmentStatus: enrollment.status,
      session: {
        id: enrollment.trainingSession.id,
        name: enrollment.trainingSession.name,
        platform: enrollment.trainingSession.platform,
        timezone: enrollment.trainingSession.timezone,
      },
      course: enrollment.trainingSession.course,
      access: accessPresentation(meeting, accessByEnrollment.get(enrollment.id), now),
    }))
  );

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
