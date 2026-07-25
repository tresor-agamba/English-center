const prisma = require('../utils/prisma');
const { TRIAL_LIMIT } = require('./enrollmentPolicy');

const CLASS_JOIN_EARLY_MINUTES = 30;

class TrialAccessError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'TrialAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function calculateTrialAccess(enrollmentId, client = prisma) {
  let enrollment = await client.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      status: true,
      attendances: {
        where: { status: 'PRESENT', classMeeting: { status: { not: 'CANCELLED' } } },
        select: { id: true },
      },
      payments: { where: { status: 'SUCCESS' }, take: 1, select: { id: true } },
    },
  });
  if (!enrollment) throw new TrialAccessError('ENROLLMENT_NOT_FOUND', 'Cette inscription est introuvable.', 404);

  const trialAttendanceCount = enrollment.attendances.length;
  const hasSuccessfulPayment = enrollment.payments.length > 0;
  let status = enrollment.status;

  if (hasSuccessfulPayment && ['TRIAL_ACTIVE', 'PAYMENT_REQUIRED', 'PAYMENT_FAILED'].includes(status)) {
    status = 'CONFIRMED';
  } else if (status === 'TRIAL_ACTIVE' && trialAttendanceCount >= TRIAL_LIMIT) {
    status = 'PAYMENT_REQUIRED';
  } else if (status === 'PAYMENT_REQUIRED' && trialAttendanceCount < TRIAL_LIMIT && !hasSuccessfulPayment) {
    status = 'TRIAL_ACTIVE';
  }

  if (status !== enrollment.status) {
    enrollment = await client.enrollment.update({
      where: { id: enrollment.id },
      data: { status },
      select: { id: true, status: true },
    });
  }

  const hasCourseAccess =
    enrollment.status === 'CONFIRMED' ||
    (enrollment.status === 'TRIAL_ACTIVE' && trialAttendanceCount < TRIAL_LIMIT);

  return {
    enrollmentStatus: enrollment.status,
    trialAttendanceCount,
    trialLimit: TRIAL_LIMIT,
    remainingTrialAttendances: Math.max(0, TRIAL_LIMIT - trialAttendanceCount),
    hasCourseAccess,
  };
}

async function getLearningOverview(enrollmentId) {
  const [trialAccess, enrollment] = await Promise.all([
    calculateTrialAccess(enrollmentId),
    prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        trainingSession: {
          select: {
            classMeetings: {
              orderBy: { startsAt: 'asc' },
              select: { id: true, title: true, startsAt: true, endsAt: true },
            },
          },
        },
      },
    }),
  ]);
  return { trialAccess, classMeetings: enrollment?.trainingSession.classMeetings || [] };
}

async function canAccessClassMeeting(userId, enrollmentId, classMeetingId) {
  const enrollment = await prisma.enrollment.findFirst({
    where: { id: enrollmentId, userId },
    select: { id: true, trainingSessionId: true },
  });
  if (!enrollment) throw new TrialAccessError('ENROLLMENT_FORBIDDEN', 'Accès interdit.', 403);

  const meeting = await prisma.classMeeting.findUnique({
    where: { id: classMeetingId },
    select: {
      id: true,
      trainingSessionId: true,
      startsAt: true,
      endsAt: true,
      privateMeetingUrl: true,
      status: true,
    },
  });
  if (!meeting || meeting.trainingSessionId !== enrollment.trainingSessionId) {
    throw new TrialAccessError('MEETING_NOT_FOUND', 'Cette séance est introuvable.', 404);
  }
  if (meeting.status !== 'SCHEDULED') {
    throw new TrialAccessError('MEETING_UNAVAILABLE', 'Cette séance n’est pas accessible.', 403);
  }

  const trialAccess = await calculateTrialAccess(enrollment.id);
  if (!trialAccess.hasCourseAccess) return { allowed: false, trialAccess };
  const now = new Date();
  const opensAt = new Date(meeting.startsAt.getTime() - CLASS_JOIN_EARLY_MINUTES * 60 * 1000);
  if (now < opensAt) {
    throw new TrialAccessError('MEETING_TOO_EARLY', `L’accès ouvre ${CLASS_JOIN_EARLY_MINUTES} minutes avant la séance.`, 403);
  }
  if (now > meeting.endsAt) {
    throw new TrialAccessError('MEETING_ENDED', 'Cette séance est terminée.', 403);
  }
  return {
    allowed: true,
    trialAccess,
    meeting: {
      id: meeting.id,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      privateMeetingUrl: meeting.privateMeetingUrl,
    },
  };
}

module.exports = {
  CLASS_JOIN_EARLY_MINUTES,
  TrialAccessError,
  calculateTrialAccess,
  getLearningOverview,
  canAccessClassMeeting,
};
