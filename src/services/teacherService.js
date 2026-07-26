const prisma = require('../utils/prisma');

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
    where: { id, role: 'TEACHER' }, select: { ...select, teachingAssignments: {
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
  return prisma.$transaction(async (tx) => {
    if (isLeadTeacher) {
      await tx.trainingSessionTeacher.updateMany({ where: { trainingSessionId, isLeadTeacher: true }, data: { isLeadTeacher: false } });
    }
    return tx.trainingSessionTeacher.upsert({
      where: { trainingSessionId_teacherId: { trainingSessionId, teacherId } },
      create: { trainingSessionId, teacherId, isLeadTeacher },
      update: { isLeadTeacher },
    });
  });
}
function unassign(teacherId, trainingSessionId) {
  return prisma.trainingSessionTeacher.deleteMany({ where: { teacherId, trainingSessionId } });
}

module.exports = { list, find, create, update, sessions, assign, unassign };
