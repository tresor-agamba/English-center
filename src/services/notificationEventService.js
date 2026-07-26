const prisma = require('../utils/prisma');
const notifications = require('./notificationService');
const reminders = require('./reminderService');

async function sessionAudience(trainingSessionId, client = prisma) {
  const session = await client.trainingSession.findUnique({
    where: { id: trainingSessionId },
    select: {
      id: true, name: true, timezone: true, course: { select: { title: true } },
      enrollments: { where: { status: { in: ['TRIAL_ACTIVE', 'CONFIRMED'] } }, select: { userId: true } },
      teachers: { select: { teacherId: true } },
    },
  });
  if (!session) return { session: null, studentIds: [], teacherIds: [] };
  return { session, studentIds: session.enrollments.map(x => x.userId), teacherIds: session.teachers.map(x => x.teacherId) };
}
async function scheduleMeeting(meeting, client = prisma) {
  if (meeting.status !== 'SCHEDULED') return [];
  const audience = await sessionAudience(meeting.trainingSessionId, client);
  const now = new Date(), users = [...new Set([...audience.studentIds, ...audience.teacherIds])], jobs = [];
  for (const [label, offset] of [['24H', 24 * 3600000], ['30M', 30 * 60000]]) {
    const scheduledFor = new Date(meeting.startsAt.getTime() - offset);
    if (scheduledFor <= now) continue;
    for (const userId of users) jobs.push(reminders.createReminder({
      userId, type: 'LIVE_CLASS_REMINDER', priority: label === '30M' ? 'HIGH' : 'NORMAL',
      title: 'Rappel de séance', message: `Votre séance « ${meeting.title || audience.session.name} » commence bientôt.`,
      actionUrl: userId && audience.teacherIds.includes(userId) ? `/teacher/meetings/${meeting.id}` : `/student/class-meetings/${meeting.id}`,
      relatedEntity: 'CLASS_MEETING', relatedId: meeting.id, scheduledFor,
      deduplicationKey: `LIVE_CLASS_REMINDER:meeting-${meeting.id}:user-${userId}:${label}`,
    }, client));
  }
  return Promise.all(jobs);
}
async function scheduleMeetingForUser(meeting, userId, client = prisma) {
  if (meeting.status !== 'SCHEDULED' || meeting.startsAt <= new Date()) return [];
  const session = await client.trainingSession.findUnique({ where: { id: meeting.trainingSessionId }, select: { name: true } });
  const jobs = [];
  for (const [label, offset] of [['24H', 24 * 3600000], ['30M', 30 * 60000]]) {
    const scheduledFor = new Date(meeting.startsAt.getTime() - offset);
    if (scheduledFor <= new Date()) continue;
    jobs.push(reminders.createReminder({
      userId, type: 'LIVE_CLASS_REMINDER', priority: label === '30M' ? 'HIGH' : 'NORMAL',
      title: 'Rappel de séance', message: `Votre séance « ${meeting.title || session.name} » commence bientôt.`,
      actionUrl: `/student/class-meetings/${meeting.id}`, relatedEntity: 'CLASS_MEETING', relatedId: meeting.id,
      scheduledFor, deduplicationKey: `LIVE_CLASS_REMINDER:meeting-${meeting.id}:user-${userId}:${label}`,
    }, client));
  }
  return Promise.all(jobs);
}
async function scheduleAssignmentForUser(assignment, userId, client = prisma) {
  if (!assignment.isPublished || !assignment.dueAt) return null;
  const scheduledFor = new Date(assignment.dueAt.getTime() - 24 * 3600000);
  if (scheduledFor <= new Date()) return null;
  return reminders.createReminder({
    userId, type: 'ASSIGNMENT_DEADLINE_REMINDER', priority: 'HIGH', title: 'Échéance de devoir',
    message: `Le devoir « ${assignment.title} » arrive bientôt à échéance.`, actionUrl: '/student/assignments',
    relatedEntity: 'ASSIGNMENT', relatedId: assignment.id, scheduledFor,
    deduplicationKey: `ASSIGNMENT_DEADLINE:assignment-${assignment.id}:user-${userId}:24H`,
  }, client);
}
async function meetingCreated(meeting) { return scheduleMeeting(meeting); }
async function meetingRescheduled(before, after) {
  const changed = ['startsAt','endsAt','status','platform','lessonId'].some(k => String(before[k]) !== String(after[k]));
  if (!changed) return;
  await reminders.cancelForEntity('CLASS_MEETING', after.id);
  const audience = await sessionAudience(after.trainingSessionId);
  await notifications.createNotificationsForUsers([...audience.studentIds, ...audience.teacherIds], {
    type: 'LIVE_CLASS_RESCHEDULED', priority: 'HIGH', title: 'Séance modifiée',
    message: `La séance « ${after.title || audience.session.name} » a été reprogrammée.`,
    actionUrl: `/notifications`, relatedEntity: 'CLASS_MEETING', relatedId: after.id,
  }, `LIVE_CLASS_RESCHEDULED:meeting-${after.id}:${after.updatedAt?.getTime?.() || after.startsAt.getTime()}`);
  await scheduleMeeting(after);
}
async function meetingCancelled(meeting) {
  await reminders.cancelForEntity('CLASS_MEETING', meeting.id);
  const audience = await sessionAudience(meeting.trainingSessionId);
  return notifications.createNotificationsForUsers([...audience.studentIds, ...audience.teacherIds], {
    type: 'LIVE_CLASS_CANCELLED', priority: 'HIGH', title: 'Séance annulée',
    message: `La séance « ${meeting.title || audience.session.name} » a été annulée.`, actionUrl: '/notifications',
    relatedEntity: 'CLASS_MEETING', relatedId: meeting.id,
  }, `LIVE_CLASS_CANCELLED:meeting-${meeting.id}`);
}
async function assignmentPublished(assignment) {
  const where = assignment.trainingSessionId ? { trainingSessionId: assignment.trainingSessionId } : { trainingSession: { courseId: assignment.courseId } };
  const enrollments = await prisma.enrollment.findMany({ where: { ...where, status: { in: ['TRIAL_ACTIVE','CONFIRMED'] } }, select: { userId: true } });
  await notifications.createNotificationsForUsers(enrollments.map(x => x.userId), {
    type: 'ASSIGNMENT_PUBLISHED', title: 'Nouveau devoir', message: `Le devoir « ${assignment.title} » est disponible.`,
    actionUrl: '/student/assignments', relatedEntity: 'ASSIGNMENT', relatedId: assignment.id,
  }, `ASSIGNMENT_PUBLISHED:assignment-${assignment.id}`);
  if (assignment.dueAt) for (const { userId } of enrollments) {
    const scheduledFor = new Date(assignment.dueAt.getTime() - 24 * 3600000);
    if (scheduledFor > new Date()) await reminders.createReminder({
      userId, type: 'ASSIGNMENT_DEADLINE_REMINDER', priority: 'HIGH', title: 'Échéance de devoir',
      message: `Le devoir « ${assignment.title} » arrive bientôt à échéance.`, actionUrl: '/student/assignments',
      relatedEntity: 'ASSIGNMENT', relatedId: assignment.id, scheduledFor,
      deduplicationKey: `ASSIGNMENT_DEADLINE:assignment-${assignment.id}:user-${userId}:24H`,
    });
  }
}
async function feedbackPublished(assignmentId, submissionId) {
  const row = await prisma.assignmentSubmission.findUnique({ where: { id: submissionId }, select: { enrollment: { select: { userId: true } }, assignment: { select: { title: true } } } });
  if (row) return notifications.createNotification({
    userId: row.enrollment.userId, type: 'FEEDBACK_PUBLISHED', title: 'Correction disponible',
    message: `La correction de votre devoir « ${row.assignment.title} » est disponible.`, actionUrl: '/student/assignments',
    relatedEntity: 'SUBMISSION', relatedId: submissionId, deduplicationKey: `FEEDBACK_PUBLISHED:submission-${submissionId}`,
  });
}
async function paymentRequired(enrollmentId, userId) { return notifications.createNotification({ userId, type: 'PAYMENT_REQUIRED', priority: 'HIGH', title: 'Paiement requis', message: 'Votre période d’essai est terminée. Un paiement est requis pour continuer les cours.', actionUrl: `/student/payments`, relatedEntity: 'ENROLLMENT', relatedId: enrollmentId, deduplicationKey: `PAYMENT_REQUIRED:enrollment-${enrollmentId}` }); }
async function paymentConfirmed(enrollmentId, paymentId, userId) { return notifications.createNotification({ userId, type: 'PAYMENT_CONFIRMED', title: 'Paiement confirmé', message: 'Votre paiement a été confirmé. Votre accès aux cours est réactivé.', actionUrl: '/student/payments', relatedEntity: 'PAYMENT', relatedId: paymentId, deduplicationKey: `PAYMENT_CONFIRMED:payment-${paymentId}` }); }
async function teacherAssigned(teacherId, session, lead) { return notifications.createNotification({ userId: teacherId, type: 'TEACHER_ASSIGNED', title: 'Nouvelle affectation', message: `Vous avez été affecté${lead ? ' comme formateur principal' : ''} à la cohorte ${session.name}.`, actionUrl: `/teacher/sessions/${session.id}`, relatedEntity: 'TRAINING_SESSION', relatedId: session.id, deduplicationKey: `TEACHER_ASSIGNED:session-${session.id}:teacher-${teacherId}:${lead}` }); }
module.exports = { sessionAudience, scheduleMeeting, scheduleMeetingForUser, scheduleAssignmentForUser, meetingCreated, meetingRescheduled, meetingCancelled, assignmentPublished, feedbackPublished, paymentRequired, paymentConfirmed, teacherAssigned };
