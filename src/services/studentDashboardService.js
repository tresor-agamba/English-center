const prisma = require('../utils/prisma');
const studentScheduleService = require('./studentScheduleService');
const trialAccessService = require('./trialAccessService');
const assignmentAccessService = require('./assignmentAccessService');

async function progressFor(userId, preferredEnrollmentId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId, status: { in: studentScheduleService.ACTIVE_ENROLLMENT_STATUSES } },
    orderBy: { enrolledAt: 'desc' },
    select: {
      id: true, requestedLevel: true, recommendedLevel: true, approvedLevel: true,
      trainingSession: { select: { course: { select: { title: true, level: true } } } },
    },
  });
  const enrollment = enrollments.find(item => item.id === preferredEnrollmentId) || enrollments[0] || null;
  if (!enrollment) return null;
  const level = enrollment.approvedLevel || enrollment.recommendedLevel || enrollment.requestedLevel || enrollment.trainingSession.course.level || null;
  const access = await trialAccessService.calculateTrialAccess(enrollment.id).catch(() => null);
  if (!access) return { enrollmentId: enrollment.id, courseTitle: enrollment.trainingSession.course.title, level, completedSessions: null, totalSessions: null, percentage: null };
  const completedSessions = Math.min(access.attendedSessionCount, access.totalSessionsLimit);
  return {
    enrollmentId: enrollment.id,
    courseTitle: enrollment.trainingSession.course.title,
    level,
    completedSessions,
    totalSessions: access.totalSessionsLimit,
    percentage: access.totalSessionsLimit ? Math.round((completedSessions / access.totalSessionsLimit) * 100) : null,
  };
}

async function getDashboard(userId) {
  const activeStatuses = studentScheduleService.ACTIVE_ENROLLMENT_STATUSES;
  const [student, statusGroups, paymentGroups, upcomingMeetings, assignments, issuedCertificates] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    prisma.enrollment.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    prisma.payment.groupBy({
      by: ['status'],
      where: { enrollment: { userId } },
      _count: { _all: true },
    }),
    studentScheduleService.getStudentMeetings(userId),
    assignmentAccessService.listAll(userId),
    prisma.certificate.count({ where: { status: 'ISSUED', certificateRequest: { enrollment: { userId } } } }),
  ]);
  const enrollmentCounts = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const paymentCounts = Object.fromEntries(paymentGroups.map((group) => [group.status, group._count._all]));
  const nextMeeting = upcomingMeetings[0] || null;
  const assignmentStats = assignmentAccessService.overview(assignments);
  const nextAssignment = assignments.filter(item => !item.submission && item.fullAccess && item.dueAt).sort((left, right) => left.dueAt - right.dueAt)[0] || null;
  return {
    student,
    stats: {
      activeEnrollments: activeStatuses.reduce((total, status) => total + (enrollmentCounts[status] || 0), 0),
      confirmed: enrollmentCounts.CONFIRMED || 0,
      trials: enrollmentCounts.TRIAL_ACTIVE || 0,
      paymentRequired: enrollmentCounts.PAYMENT_REQUIRED || 0,
      upcomingMeetings: upcomingMeetings.length,
      successfulPayments: paymentCounts.SUCCESS || 0,
      pendingPayments: (paymentCounts.PENDING || 0) + (paymentCounts.PROCESSING || 0),
    },
    upcomingMeetings: upcomingMeetings.slice(0, 3),
    nextMeeting,
    progress: await progressFor(userId, nextMeeting?.enrollmentId),
    priorities: {
      assignments: { todo: assignmentStats.todo, nextDueAt: nextAssignment?.dueAt || null },
      payment: { required: enrollmentCounts.PAYMENT_REQUIRED || 0, pending: (paymentCounts.PENDING || 0) + (paymentCounts.PROCESSING || 0) },
      certificate: { available: issuedCertificates },
    },
  };
}

module.exports = { getDashboard };
