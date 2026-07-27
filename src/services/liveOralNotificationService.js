const prisma = require('../utils/prisma');
const notifications = require('./notificationService');
const reminders = require('./reminderService');
const whatsappDeliveries = require('./whatsappDeliveryService');

async function audience(sessionId, client = prisma) {
  const session = await client.liveOralSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      scheduledStartAt: true,
      assessment: { select: { title: true } },
      participants: { select: { enrollment: { select: { userId: true } } } },
      examiners: { select: { teacherId: true } },
    },
  });
  if (!session) return null;
  return {
    session,
    students: [...new Set(session.participants.map(item => item.enrollment.userId))],
    teachers: [...new Set(session.examiners.map(item => item.teacherId))],
  };
}

async function scheduleReminders(sessionId, client = prisma) {
  const data = await audience(sessionId, client);
  if (!data) return [];
  const jobs = [];
  const recipients = [
    ...data.students.map(userId => ({ userId, actionUrl: `/student/live-oral-sessions/${sessionId}` })),
    ...data.teachers.map(userId => ({ userId, actionUrl: `/teacher/live-oral-sessions/${sessionId}` })),
  ];
  for (const [label, offset] of [['24H', 24 * 3600000], ['1H', 3600000]]) {
    const scheduledFor = new Date(data.session.scheduledStartAt.getTime() - offset);
    if (scheduledFor <= new Date()) continue;
    for (const recipient of recipients) {
      jobs.push(reminders.createReminder({
        userId: recipient.userId,
        type: 'LIVE_ORAL_REMINDER',
        priority: label === '1H' ? 'HIGH' : 'NORMAL',
        title: 'Rappel d’examen oral',
        message: `Votre examen « ${data.session.assessment.title} » approche. Connectez-vous à votre espace pour les détails.`,
        actionUrl: recipient.actionUrl,
        relatedEntity: 'LIVE_ORAL_SESSION',
        relatedId: sessionId,
        scheduledFor,
        deduplicationKey: `LIVE_ORAL_REMINDER:session-${sessionId}:user-${recipient.userId}:${label}`,
      }, client));
    }
  }
  return Promise.all(jobs);
}

async function notifyScheduled(sessionId) {
  const data = await audience(sessionId);
  if (!data) return [];
  const users = [...data.students, ...data.teachers];
  await notifications.createNotificationsForUsers(users, {
    type: 'LIVE_ORAL_SCHEDULED',
    title: 'Examen oral programmé',
    message: `L’examen « ${data.session.assessment.title} » a été programmé. Consultez votre espace pour les détails.`,
    actionUrl: '/notifications',
    relatedEntity: 'LIVE_ORAL_SESSION',
    relatedId: sessionId,
  }, `LIVE_ORAL_SCHEDULED:session-${sessionId}`);
  return scheduleReminders(sessionId);
}

async function cancelPending(sessionId) {
  await Promise.all([
    reminders.cancelForEntity('LIVE_ORAL_SESSION', sessionId),
    whatsappDeliveries.cancelPendingForEntity('LIVE_ORAL_SESSION', sessionId),
  ]);
}

async function notifyRescheduled(oldSessionId, newSessionId) {
  await cancelPending(oldSessionId);
  const data = await audience(newSessionId);
  if (!data) return [];
  await notifications.createNotificationsForUsers([...data.students, ...data.teachers], {
    type: 'LIVE_ORAL_RESCHEDULED',
    priority: 'HIGH',
    title: 'Examen oral reporté',
    message: `L’examen « ${data.session.assessment.title} » a été reprogrammé. Consultez le nouveau créneau dans votre espace.`,
    actionUrl: '/notifications',
    relatedEntity: 'LIVE_ORAL_SESSION',
    relatedId: newSessionId,
  }, `LIVE_ORAL_RESCHEDULED:old-${oldSessionId}:new-${newSessionId}`);
  return scheduleReminders(newSessionId);
}

async function notifyCancelled(sessionId) {
  await cancelPending(sessionId);
  const data = await audience(sessionId);
  if (!data) return [];
  return notifications.createNotificationsForUsers([...data.students, ...data.teachers], {
    type: 'LIVE_ORAL_CANCELLED',
    priority: 'HIGH',
    title: 'Examen oral annulé',
    message: `L’examen « ${data.session.assessment.title} » a été annulé. Consultez votre espace pour les informations administratives.`,
    actionUrl: '/notifications',
    relatedEntity: 'LIVE_ORAL_SESSION',
    relatedId: sessionId,
  }, `LIVE_ORAL_CANCELLED:session-${sessionId}`);
}

module.exports = { audience, scheduleReminders, notifyScheduled, cancelPending, notifyRescheduled, notifyCancelled };
