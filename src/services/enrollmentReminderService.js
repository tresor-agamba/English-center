const prisma = require('../utils/prisma');
const events = require('./notificationEventService');

const ELIGIBLE_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];
const CANCELLABLE_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'];

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) { const error = new Error('Inscription invalide.'); error.statusCode = 400; throw error; }
  return id;
}
async function loadEnrollment(enrollmentId, client = prisma) {
  const enrollment = await client.enrollment.findUnique({
    where: { id: parseId(enrollmentId) },
    select: {
      id: true, userId: true, status: true, trainingSessionId: true,
      trainingSession: { select: { courseId: true } },
    },
  });
  if (!enrollment) { const error = new Error('Inscription introuvable.'); error.statusCode = 404; throw error; }
  return enrollment;
}
async function relevantEntityIds(enrollment, client = prisma) {
  const [meetings, assignments] = await Promise.all([
    client.classMeeting.findMany({ where: { trainingSessionId: enrollment.trainingSessionId }, select: { id: true } }),
    client.assignment.findMany({
      where: { courseId: enrollment.trainingSession.courseId, OR: [{ trainingSessionId: null }, { trainingSessionId: enrollment.trainingSessionId }] },
      select: { id: true },
    }),
  ]);
  return { meetingIds: meetings.map(x => x.id), assignmentIds: assignments.map(x => x.id) };
}
async function cancelEnrollmentFutureReminders(enrollmentId, options = {}) {
  const client = options.client || prisma;
  const enrollment = await loadEnrollment(enrollmentId, client);
  const ids = await relevantEntityIds(enrollment, client);
  const result = await client.scheduledReminder.updateMany({
    where: {
      userId: enrollment.userId, status: { in: CANCELLABLE_STATUSES },
      OR: [
        { relatedEntity: 'CLASS_MEETING', relatedId: { in: ids.meetingIds } },
        { relatedEntity: 'ASSIGNMENT', relatedId: { in: ids.assignmentIds } },
        { relatedEntity: 'ENROLLMENT', relatedId: enrollment.id },
        { relatedEntity: 'TRAINING_SESSION', relatedId: enrollment.trainingSessionId },
      ],
    },
    data: { status: 'CANCELLED', processedAt: new Date() },
  });
  return result.count;
}
async function scheduleFutureMeetingReminders(enrollmentId, options = {}) {
  const client = options.client || prisma, now = options.now || new Date();
  const enrollment = await loadEnrollment(enrollmentId, client);
  if (!ELIGIBLE_STATUSES.includes(enrollment.status)) return 0;
  const meetings = await client.classMeeting.findMany({
    where: { trainingSessionId: enrollment.trainingSessionId, status: 'SCHEDULED', startsAt: { gt: now } },
    select: { id: true, title: true, startsAt: true, trainingSessionId: true, status: true },
  });
  let count = 0;
  for (const meeting of meetings) count += (await events.scheduleMeetingForUser(meeting, enrollment.userId, client)).length;
  return count;
}
async function scheduleFutureAssignmentReminders(enrollmentId, options = {}) {
  const client = options.client || prisma, now = options.now || new Date();
  const enrollment = await loadEnrollment(enrollmentId, client);
  if (!ELIGIBLE_STATUSES.includes(enrollment.status)) return 0;
  const assignments = await client.assignment.findMany({
    where: {
      courseId: enrollment.trainingSession.courseId, isPublished: true, dueAt: { gt: now },
      OR: [{ trainingSessionId: null }, { trainingSessionId: enrollment.trainingSessionId }],
      submissions: { none: { enrollmentId: enrollment.id } },
    },
    select: { id: true, title: true, dueAt: true, isPublished: true },
  });
  let count = 0;
  for (const assignment of assignments) if (await events.scheduleAssignmentForUser(assignment, enrollment.userId, client)) count += 1;
  return count;
}
async function synchronizeEnrollmentReminders(enrollmentId, options = {}) {
  const enrollment = await loadEnrollment(enrollmentId, options.client || prisma);
  const cancelled = await cancelEnrollmentFutureReminders(enrollment.id, options);
  if (!ELIGIBLE_STATUSES.includes(enrollment.status)) return { enrollmentId: enrollment.id, status: enrollment.status, cancelled, scheduled: 0 };
  const [meetings, assignments] = await Promise.all([
    scheduleFutureMeetingReminders(enrollment.id, options),
    scheduleFutureAssignmentReminders(enrollment.id, options),
  ]);
  return { enrollmentId: enrollment.id, status: enrollment.status, cancelled, meetings, assignments, scheduled: meetings + assignments };
}
async function rescheduleEnrollmentReminders(enrollmentId, previousTrainingSessionId) {
  if (previousTrainingSessionId) {
    const enrollment = await loadEnrollment(enrollmentId);
    const oldMeetings = await prisma.classMeeting.findMany({ where: { trainingSessionId: previousTrainingSessionId }, select: { id: true } });
    await prisma.scheduledReminder.updateMany({ where: { userId: enrollment.userId, relatedEntity: 'CLASS_MEETING', relatedId: { in: oldMeetings.map(x => x.id) }, status: { in: CANCELLABLE_STATUSES } }, data: { status: 'CANCELLED', processedAt: new Date() } });
  }
  return synchronizeEnrollmentReminders(enrollmentId);
}
module.exports = { ELIGIBLE_STATUSES, synchronizeEnrollmentReminders, scheduleFutureMeetingReminders, scheduleFutureAssignmentReminders, cancelEnrollmentFutureReminders, rescheduleEnrollmentReminders };
