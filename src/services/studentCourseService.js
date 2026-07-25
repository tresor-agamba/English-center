const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');
const studentScheduleService = require('./studentScheduleService');

const COURSE_SELECT = {
  id: true,
  title: true,
  courseType: true,
  level: true,
  duration: true,
  durationValue: true,
  durationUnit: true,
  description: true,
  price: true,
  currency: true,
};

function paymentState(payments, now = new Date()) {
  const activePayment = payments.find(
    (payment) => ['PENDING', 'PROCESSING'].includes(payment.status) && (!payment.expiresAt || payment.expiresAt > now)
  );
  return {
    activePayment,
    successfulPayment: payments.find((payment) => payment.status === 'SUCCESS'),
    lastFailedPayment: payments.find((payment) => payment.status === 'FAILED'),
    latestPayment: payments[0] || null,
  };
}

async function listStudentCourses(userId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    orderBy: { enrolledAt: 'desc' },
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      trainingSession: {
        select: {
          id: true, name: true, startDate: true, endDate: true, weekDays: true,
          startTime: true, endTime: true, platform: true, timezone: true,
          course: { select: COURSE_SELECT },
        },
      },
    },
  });
  const trialStates = await Promise.all(enrollments.map((item) => trialAccessService.calculateTrialAccess(item.id)));
  return enrollments.map((item, index) => ({ ...item, trialAccess: trialStates[index] }));
}

async function getStudentCourse(userId, enrollmentId) {
  const id = Number(enrollmentId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      enrolledAt: true,
      trainingSession: {
        select: {
          id: true, name: true, startDate: true, endDate: true, weekDays: true,
          startTime: true, endTime: true, platform: true, timezone: true,
          course: { select: COURSE_SELECT },
          classMeetings: {
            orderBy: { startsAt: 'asc' },
            select: {
              id: true, title: true, startsAt: true, endsAt: true, status: true,
              attendances: {
                where: { enrollmentId: id },
                select: { status: true },
                take: 1,
              },
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, reference: true, amount: true, currency: true, status: true,
          failureReason: true, paidAt: true, expiresAt: true, createdAt: true,
        },
      },
    },
  });
  if (!enrollment) return null;
  const trialAccess = await trialAccessService.calculateTrialAccess(id);
  const now = new Date();
  const meetings = enrollment.trainingSession.classMeetings.map((meeting) => ({
    ...meeting,
    attendance: meeting.attendances[0]?.status || null,
    access: studentScheduleService.accessPresentation(meeting, trialAccess, now),
  }));
  return {
    ...enrollment,
    status: trialAccess.enrollmentStatus,
    trialAccess,
    payments: paymentState(enrollment.payments, now),
    meetings,
    nextMeeting: meetings.find((meeting) => meeting.status === 'SCHEDULED' && meeting.endsAt >= now) || null,
  };
}

module.exports = { COURSE_SELECT, paymentState, listStudentCourses, getStudentCourse };
