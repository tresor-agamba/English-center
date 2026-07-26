const prisma = require('../utils/prisma');
const notificationEvents = require('./notificationEventService');

const select = { id: true, firstName: true, lastName: true, phoneNumber: true, isActive: true, createdAt: true };

function list(search = '') {
  const value = search.trim();
  return prisma.user.findMany({
    where: { role: 'TEACHER', ...(value ? { OR: [
      { firstName: { contains: value, mode: 'insensitive' } },
      { lastName: { contains: value, mode: 'insensitive' } },
      { phoneNumber: { contains: value } },
    ] } : {}) },
    select, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}
function find(id) {
  return prisma.user.findFirst({
    where: { id, role: 'TEACHER' }, select: { ...select, whatsappPreference: true, teachingAssignments: {
      include: { trainingSession: { include: { course: true } } }, orderBy: { createdAt: 'desc' },
    } },
  });
}
function create(data) { return prisma.user.create({ data: { ...data, role: 'TEACHER' }, select }); }
function update(id, data) { return prisma.user.updateMany({ where: { id, role: 'TEACHER' }, data }); }
function sessions() {
  return prisma.trainingSession.findMany({ orderBy: { startDate: 'desc' }, include: { course: true } });
}
async function assign({ teacherId, trainingSessionId, isLeadTeacher }) {
  const [teacher, session] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, role: 'TEACHER' }, select: { id: true } }),
    prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, select: { id: true } }),
  ]);
  if (!teacher || !session) { const error = new Error('Enseignant ou session introuvable.'); error.statusCode = 404; throw error; }
  const result = await prisma.$transaction(async (tx) => {
    if (isLeadTeacher) {
      await tx.trainingSessionTeacher.updateMany({ where: { trainingSessionId, isLeadTeacher: true }, data: { isLeadTeacher: false } });
    }
    return tx.trainingSessionTeacher.upsert({
      where: { trainingSessionId_teacherId: { trainingSessionId, teacherId } },
      create: { trainingSessionId, teacherId, isLeadTeacher },
      update: { isLeadTeacher },
    });
  });
  const details = await prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, select: { id: true, name: true } });
  await notificationEvents.teacherAssigned(teacherId, details, isLeadTeacher).catch((error) => console.error('Notification affectation:', error.message));
  return result;
}
async function unassign(teacherId, trainingSessionId) {
  const result = await prisma.trainingSessionTeacher.deleteMany({ where: { teacherId, trainingSessionId } });
  const meetings = await prisma.classMeeting.findMany({ where: { trainingSessionId }, select: { id: true } });
  await prisma.scheduledReminder.updateMany({ where: { userId: teacherId, status: { in: ['PENDING','FAILED'] }, relatedEntity: 'CLASS_MEETING', relatedId: { in: meetings.map(x => x.id) } }, data: { status: 'CANCELLED', processedAt: new Date() } });
  return result;
}

module.exports = { list, find, create, update, sessions, assign, unassign };
