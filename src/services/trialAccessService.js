const prisma = require('../utils/prisma');
const { Prisma } = require('@prisma/client');
const logger = require('./loggerService');
const { TRIAL_LIMIT, PARTIAL_ACCESS_LIMIT, TOTAL_SESSIONS_LIMIT } = require('./enrollmentPolicy');

const CLASS_JOIN_EARLY_MINUTES = 30;

function evaluateMeetingAccess(meeting, trialAccess, now = new Date()) {
  if (meeting.status === 'CANCELLED') return { code: 'CANCELLED', label: 'Cours annulé', canJoin: false };
  if (meeting.status !== 'SCHEDULED' || now > meeting.endsAt) {
    return { code: 'ENDED', label: 'Cours terminé', canJoin: false };
  }
  if (meeting.levelPosition && meeting.levelPosition > TOTAL_SESSIONS_LIMIT) {
    return { code: 'LEVEL_COMPLETED', label: 'Niveau terminé', canJoin: false };
  }
  if (meeting.levelPosition && meeting.levelPosition > trialAccess.nextSessionLimit) {
    return { code: 'PAYMENT_REQUIRED', label: 'Paiement requis', canJoin: false };
  }
  if (!trialAccess.hasCourseAccess) {
    return { code: 'PAYMENT_REQUIRED', label: 'Paiement requis', canJoin: false };
  }
  const opensAt = new Date(meeting.startsAt.getTime() - CLASS_JOIN_EARLY_MINUTES * 60000);
  if (now < opensAt) {
    return { code: 'UPCOMING', label: 'Disponible bientôt', canJoin: false, opensAt };
  }
  return { code: 'OPEN', label: 'Accès ouvert', canJoin: true, opensAt };
}

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
      userId: true,
      status: true,
      expectedTotalAmount: true,
      expectedCurrency: true,
      firstHalfReachedAt: true,
      fullyPaidAt: true,
      accessBlockedAt: true,
      accessUnlockedAt: true,
      trainingSession: {
        select: {
          course: {
            select: {
              id: true, price: true, registrationFee: true, currency: true,
              pricingMode: true, pricingActive: true,
            },
          },
          classMeetings: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            take: TOTAL_SESSIONS_LIMIT,
            select: {
              id: true, startsAt: true,
              attendances: {
                where: { enrollmentId, status: 'PRESENT' },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
      attendances: {
        where: {
          status: 'PRESENT',
          classMeeting: { status: { not: 'CANCELLED' }, startsAt: { lte: new Date() } },
        },
        select: { classMeetingId: true },
      },
      payments: {
        where: { status: 'SUCCESS' },
        select: { id: true, amount: true, currency: true, courseId: true, paidAt: true },
      },
    },
  });
  if (!enrollment) throw new TrialAccessError('ENROLLMENT_NOT_FOUND', 'Cette inscription est introuvable.', 404);

  const course = enrollment.trainingSession.course;
  if (course.pricingMode === 'FREE') {
    throw new TrialAccessError('PAID_COURSE_REQUIRED', 'Cette formation doit disposer d’un tarif payant.', 409);
  }
  const pricingUnavailable = course.price === null || !course.pricingMode;
  let expectedTotalAmount = enrollment.expectedTotalAmount;
  let expectedCurrency = enrollment.expectedCurrency;
  if ((expectedTotalAmount === null || !expectedCurrency) && !pricingUnavailable) {
    expectedTotalAmount = new Prisma.Decimal(course.price);
    expectedCurrency = course.currency;
    await client.enrollment.update({
      where: { id: enrollment.id },
      data: { expectedTotalAmount, expectedCurrency },
    });
  }
  if (!pricingUnavailable && new Prisma.Decimal(expectedTotalAmount).lte(0)) {
    throw new TrialAccessError('PAID_COURSE_REQUIRED', 'Le prix total de la formation doit être supérieur à zéro.', 409);
  }

  const levelMeetingIds = new Set(enrollment.trainingSession.classMeetings.map((meeting) => meeting.id));
  const attendedSessionCount = new Set(enrollment.attendances
    .filter((attendance) => levelMeetingIds.has(attendance.classMeetingId))
    .map((attendance) => attendance.classMeetingId)).size;
  const confirmedPayments = enrollment.payments.filter(
    (payment) => payment.currency === expectedCurrency && payment.courseId === course.id
  );
  const confirmedPaidAmount = confirmedPayments.reduce(
    (sum, payment) => sum.add(payment.amount),
    new Prisma.Decimal(0)
  );
  const total = new Prisma.Decimal(expectedTotalAmount || 0);
  const remainingAmount = Prisma.Decimal.max(total.sub(confirmedPaidAmount), 0);
  const paidRatio = total.gt(0)
    ? Prisma.Decimal.min(confirmedPaidAmount.div(total), 1)
    : new Prisma.Decimal(0);
  const halfAmount = total.mul(0.5);
  const paidInFull = paidRatio.gte(1);
  const now = new Date();

  let accessStage;
  let allowed;
  let nextSessionLimit;
  let blockedReason = null;
  if (enrollment.status === 'PLACEMENT_TEST_REQUIRED') {
    accessStage = 'PLACEMENT_TEST_REQUIRED'; allowed = false; nextSessionLimit = 0;
    blockedReason = 'PLACEMENT_TEST_REQUIRED';
  } else if (attendedSessionCount >= TOTAL_SESSIONS_LIMIT) {
    accessStage = 'COMPLETED'; allowed = false; nextSessionLimit = TOTAL_SESSIONS_LIMIT;
    blockedReason = 'LEVEL_COMPLETED';
  } else if (paidInFull) {
    accessStage = 'FULL_ACCESS'; allowed = true; nextSessionLimit = TOTAL_SESSIONS_LIMIT;
  } else if (attendedSessionCount >= PARTIAL_ACCESS_LIMIT) {
    accessStage = 'PAYMENT_REQUIRED_FULL'; allowed = false; nextSessionLimit = PARTIAL_ACCESS_LIMIT;
    blockedReason = pricingUnavailable ? 'PRICE_UNAVAILABLE' : 'FULL_PAYMENT_REQUIRED';
  } else if (paidRatio.gte(0.5)) {
    accessStage = 'PARTIAL_ACCESS'; allowed = true; nextSessionLimit = PARTIAL_ACCESS_LIMIT;
  } else if (attendedSessionCount >= TRIAL_LIMIT) {
    accessStage = 'PAYMENT_REQUIRED_50'; allowed = false; nextSessionLimit = TRIAL_LIMIT;
    blockedReason = pricingUnavailable ? 'PRICE_UNAVAILABLE' : 'HALF_PAYMENT_REQUIRED';
  } else {
    accessStage = 'FREE_TRIAL'; allowed = true; nextSessionLimit = TRIAL_LIMIT;
  }
  const status = accessStage === 'PLACEMENT_TEST_REQUIRED'
    ? 'PLACEMENT_TEST_REQUIRED'
    : accessStage === 'FULL_ACCESS' || accessStage === 'COMPLETED'
    ? 'CONFIRMED'
    : (allowed ? 'TRIAL_ACTIVE' : 'PAYMENT_REQUIRED');
  const updates = {};
  if (status !== enrollment.status && enrollment.status !== 'CANCELLED') updates.status = status;
  if (paidRatio.gte(0.5) && !enrollment.firstHalfReachedAt) updates.firstHalfReachedAt = now;
  if (paidInFull && !enrollment.fullyPaidAt) updates.fullyPaidAt = now;
  if (!allowed && accessStage !== 'PLACEMENT_TEST_REQUIRED' && !enrollment.accessBlockedAt) updates.accessBlockedAt = now;
  if (allowed && enrollment.accessBlockedAt && (!enrollment.accessUnlockedAt || enrollment.accessUnlockedAt < enrollment.accessBlockedAt)) {
    updates.accessUnlockedAt = now;
  }
  if (Object.keys(updates).length) {
    await client.enrollment.update({ where: { id: enrollment.id }, data: updates });
    if (accessStage === 'PAYMENT_REQUIRED_50' && updates.accessBlockedAt) {
      logger.audit('STUDENT_TRIAL_FIFTH_SESSION_CONSUMED', {
        enrollmentId: enrollment.id, userId: enrollment.userId, attendedSessionCount,
      });
      logger.audit('STUDENT_COURSE_ACCESS_BLOCKED_FOR_HALF_PAYMENT', {
        enrollmentId: enrollment.id, userId: enrollment.userId,
      });
    }
    if (accessStage === 'FULL_ACCESS' && updates.fullyPaidAt) {
      logger.audit('STUDENT_FULL_PAYMENT_CONFIRMED', {
        enrollmentId: enrollment.id, userId: enrollment.userId,
        expectedTotalAmount: total.toString(), expectedCurrency,
      });
    }
    if (accessStage === 'FULL_ACCESS' && updates.accessUnlockedAt) {
      logger.audit('STUDENT_COURSE_ACCESS_UNLOCKED', {
        enrollmentId: enrollment.id, userId: enrollment.userId,
      });
    }
    logger.audit('STUDENT_COURSE_ACCESS_STAGE_CHANGED', {
      enrollmentId: enrollment.id, userId: enrollment.userId, accessStage,
      attendedSessionCount, paidPercentage: paidRatio.mul(100).toFixed(2),
    });
  }
  let nextRequiredPaymentAmount = new Prisma.Decimal(0);
  if (!pricingUnavailable && accessStage !== 'PLACEMENT_TEST_REQUIRED') {
    if (['FREE_TRIAL', 'PAYMENT_REQUIRED_50'].includes(accessStage)) {
      nextRequiredPaymentAmount = Prisma.Decimal.max(halfAmount.sub(confirmedPaidAmount), 0);
    } else if (['PARTIAL_ACCESS', 'PAYMENT_REQUIRED_FULL'].includes(accessStage)) {
      nextRequiredPaymentAmount = remainingAmount;
    }
  }

  return {
    enrollmentId: enrollment.id,
    allowed,
    hasCourseAccess: allowed,
    accessStage,
    enrollmentStatus: status,
    attendedSessionCount,
    trialAttendanceCount: attendedSessionCount,
    trialLimit: TRIAL_LIMIT,
    freeSessionsLimit: TRIAL_LIMIT,
    partialAccessLimit: PARTIAL_ACCESS_LIMIT,
    totalSessionsLimit: TOTAL_SESSIONS_LIMIT,
    remainingTrialAttendances: Math.max(0, TRIAL_LIMIT - attendedSessionCount),
    confirmedPaidAmount,
    expectedTotalAmount: total,
    expectedCurrency: expectedCurrency || course.currency,
    remainingAmount,
    paidRatio,
    paidPercentage: Number(paidRatio.mul(100).toFixed(2)),
    paidInFull,
    paymentRequired: !paidInFull,
    nextRequiredPaymentAmount,
    blockedReason,
    nextSessionLimit,
    firstHalfReachedAt: updates.firstHalfReachedAt || enrollment.firstHalfReachedAt,
    fullyPaidAt: updates.fullyPaidAt || enrollment.fullyPaidAt,
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
              select: { id: true, title: true, startsAt: true, endsAt: true, status: true },
            },
          },
        },
      },
    }),
  ]);
  let levelPosition = 0;
  const classMeetings = (enrollment?.trainingSession.classMeetings || []).map((meeting) => ({
    ...meeting,
    levelPosition: meeting.status === 'CANCELLED' ? null : (levelPosition += 1),
  })).map((meeting) => ({ ...meeting, access: evaluateMeetingAccess(meeting, trialAccess) }));
  return { trialAccess, classMeetings };
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
  const orderedMeetings = await prisma.classMeeting.findMany({
    where: { trainingSessionId: enrollment.trainingSessionId, status: { not: 'CANCELLED' } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  const levelPosition = orderedMeetings.findIndex((item) => item.id === meeting.id) + 1;
  if (!levelPosition || levelPosition > trialAccess.nextSessionLimit || levelPosition > TOTAL_SESSIONS_LIMIT) {
    logger.security('STUDENT_COURSE_ACCESS_BYPASS_REFUSED', {
      userId, enrollmentId: enrollment.id, classMeetingId: meeting.id,
      accessStage: trialAccess.accessStage, levelPosition,
    });
    return { allowed: false, trialAccess };
  }
  if (!trialAccess.hasCourseAccess) return { allowed: false, trialAccess };
  const now = new Date();
  const opensAt = new Date(meeting.startsAt.getTime() - CLASS_JOIN_EARLY_MINUTES * 60 * 1000);
  if (now < opensAt) {
    throw new TrialAccessError('MEETING_TOO_EARLY', `L’accès ouvre ${CLASS_JOIN_EARLY_MINUTES} minutes avant la séance.`, 403);
  }
  if (now > meeting.endsAt) {
    throw new TrialAccessError('MEETING_ENDED', 'Cette séance est terminée.', 403);
  }
  let meetingUrl;
  try {
    meetingUrl = new URL(meeting.privateMeetingUrl);
  } catch {
    throw new TrialAccessError('MEETING_URL_INVALID', 'Le lien de cette séance est indisponible.', 403);
  }
  if (meetingUrl.protocol !== 'https:') {
    throw new TrialAccessError('MEETING_URL_INVALID', 'Le lien de cette séance est indisponible.', 403);
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
  evaluateMeetingAccess,
  TrialAccessError,
  calculateTrialAccess,
  getLearningOverview,
  canAccessClassMeeting,
};
