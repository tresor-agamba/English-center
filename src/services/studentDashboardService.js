const prisma = require('../utils/prisma');
const studentScheduleService = require('./studentScheduleService');

async function getDashboard(userId) {
  const activeStatuses = studentScheduleService.ACTIVE_ENROLLMENT_STATUSES;
  const [student, statusGroups, paymentGroups, upcomingMeetings] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    prisma.enrollment.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
    prisma.payment.groupBy({
      by: ['status'],
      where: { enrollment: { userId } },
      _count: { _all: true },
    }),
    studentScheduleService.getStudentMeetings(userId),
  ]);
  const enrollmentCounts = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const paymentCounts = Object.fromEntries(paymentGroups.map((group) => [group.status, group._count._all]));
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
    upcomingMeetings: upcomingMeetings.slice(0, 5),
    nextAccessibleMeeting: upcomingMeetings.find((meeting) => meeting.access.canJoin) || null,
  };
}

module.exports = { getDashboard };
