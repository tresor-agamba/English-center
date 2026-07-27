const prisma = require('../utils/prisma');
const notificationService = require('./notificationService');
const MAX_ATTEMPTS = 3;

async function createReminder(data, client = prisma) {
  const existing = await client.scheduledReminder.findUnique({ where: { deduplicationKey: data.deduplicationKey }, select: { id: true, status: true } });
  if (existing?.status === 'SENT') return client.scheduledReminder.findUnique({ where: { id: existing.id } });
  return client.scheduledReminder.upsert({
    where: { deduplicationKey: data.deduplicationKey },
    create: data,
    update: { ...data, status: 'PENDING', attempts: 0, processedAt: null, failureReason: null },
  });
}
function cancelForEntity(relatedEntity, relatedId, userId, client = prisma) {
  return client.scheduledReminder.updateMany({
    where: { relatedEntity, relatedId, ...(userId ? { userId } : {}), status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
    data: { status: 'CANCELLED', processedAt: new Date() },
  });
}
async function recoverAbandoned(now = new Date(), client = prisma) {
  const threshold = new Date(now.getTime() - 15 * 60000);
  return client.scheduledReminder.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: threshold }, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: 'PENDING', failureReason: 'Traitement interrompu, nouvelle tentative planifiée.' },
  });
}
async function isStillRelevant(reminder, client) {
  if (reminder.relatedEntity === 'CLASS_MEETING') {
    const meeting = await client.classMeeting.findUnique({ where: { id: reminder.relatedId }, select: { status: true, startsAt: true, trainingSessionId: true } });
    if (!meeting || meeting.status !== 'SCHEDULED' || meeting.startsAt <= new Date()) return false;
    return Boolean(await client.enrollment.findFirst({ where: { userId: reminder.userId, trainingSessionId: meeting.trainingSessionId, status: { in: ['TRIAL_ACTIVE','CONFIRMED'] } }, select: { id: true } }));
  }
  if (reminder.relatedEntity === 'ASSIGNMENT') {
    const assignment = await client.assignment.findUnique({
      where: { id: reminder.relatedId }, select: { courseId: true, trainingSessionId: true, isPublished: true, dueAt: true, submissions: { where: { enrollment: { userId: reminder.userId } }, take: 1, select: { id: true } } },
    });
    if (!assignment?.isPublished || !assignment.dueAt || assignment.dueAt <= new Date() || assignment.submissions.length) return false;
    return Boolean(await client.enrollment.findFirst({ where: {
      userId: reminder.userId, status: { in: ['TRIAL_ACTIVE','CONFIRMED'] },
      trainingSession: { courseId: assignment.courseId },
      ...(assignment.trainingSessionId ? { trainingSessionId: assignment.trainingSessionId } : {}),
    }, select: { id: true } }));
  }
  if (reminder.relatedEntity === 'LIVE_ORAL_SESSION') {
    const session = await client.liveOralSession.findUnique({
      where: { id: reminder.relatedId },
      select: {
        status: true,
        scheduledStartAt: true,
        participants: { where: { enrollment: { userId: reminder.userId } }, select: { id: true } },
        examiners: { where: { teacherId: reminder.userId }, select: { id: true } },
      },
    });
    return Boolean(
      session
      && ['SCHEDULED', 'READY'].includes(session.status)
      && session.scheduledStartAt > new Date()
      && (session.participants.length || session.examiners.length),
    );
  }
  return true;
}
async function processOne(value) {
  const claimed = await prisma.scheduledReminder.updateMany({
    where: { id: value, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, failureReason: null },
  });
  if (!claimed.count) return { skipped: true };
  try {
    return await prisma.$transaction(async (tx) => {
      const reminder = await tx.scheduledReminder.findUnique({ where: { id: value } });
      if (!await isStillRelevant(reminder, tx)) {
        await tx.scheduledReminder.update({ where: { id: value }, data: { status: 'CANCELLED', processedAt: new Date() } });
        return { cancelled: true };
      }
      await notificationService.createNotification({
        userId: reminder.userId, type: reminder.type, priority: reminder.priority, title: reminder.title,
        message: reminder.message, actionUrl: reminder.actionUrl, relatedEntity: reminder.relatedEntity,
        relatedId: reminder.relatedId, deduplicationKey: `reminder:${reminder.deduplicationKey}`,
      }, tx);
      await tx.scheduledReminder.update({ where: { id: value }, data: { status: 'SENT', processedAt: new Date() } });
      return { sent: true };
    });
  } catch (error) {
    await prisma.scheduledReminder.update({ where: { id: value }, data: { status: 'FAILED', failureReason: 'Échec technique du traitement.' } });
    throw error;
  }
}
async function processDue({ now = new Date(), limit = 50 } = {}) {
  await recoverAbandoned(now);
  const due = await prisma.scheduledReminder.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, scheduledFor: { lte: now }, attempts: { lt: MAX_ATTEMPTS } },
    select: { id: true }, orderBy: { scheduledFor: 'asc' }, take: Math.min(limit, 100),
  });
  const results = [];
  for (const item of due) {
    try { results.push(await processOne(item.id)); } catch (error) { console.error('Échec rappel', item.id, error.message); results.push({ failed: true }); }
  }
  return results;
}
module.exports = { MAX_ATTEMPTS, createReminder, cancelForEntity, recoverAbandoned, processOne, processDue };
