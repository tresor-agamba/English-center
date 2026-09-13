const structure = require('./courseStructureService');
const prisma = require('../utils/prisma');

function list() {
  return prisma.trainingSession.findMany({
    include: {
      course: true,
      _count: { select: { enrollments: true } },
    },
    orderBy: { startDate: 'desc' },
  });
}

function findById(id) {
  return prisma.trainingSession.findUnique({
    where: { id },
    include: {
      course: true,
      enrollments: {
        include: { user: true, registrationGroup: true },
        orderBy: { enrolledAt: 'desc' },
      },
      registrationGroups: { include: { teacher: true, _count: { select: { enrollments: { where: { status: { in: ['TRIAL_ACTIVE','PLACEMENT_TEST_REQUIRED','PAYMENT_REQUIRED','CONFIRMED'] } } } } } }, orderBy: { startTime: 'asc' } },
    },
  });
}

function listCourses() {
  return prisma.course.findMany({ orderBy: { title: 'asc' } });
}

function findCourse(id) {
  return prisma.course.findUnique({ where: { id }, select: { id: true } });
}

async function create(data) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM courses WHERE id = ${data.courseId} FOR UPDATE`;
    const course = await tx.course.findUnique({ where: { id: data.courseId } });
    return tx.trainingSession.create({ data: { ...data, levelNumber: structure.validateSessionLevel(course, data.levelNumber) } });
  });
}

async function update(id, data) {
  return prisma.$transaction(async tx => {
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id } });
    const merged = { ...current, ...data };
    for (const courseId of [...new Set([current.courseId, merged.courseId])].sort((a,b) => a-b)) await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId} FOR UPDATE`;
    const course = await tx.course.findUnique({ where: { id: merged.courseId } });
    const levelNumber = structure.validateSessionLevel(course, merged.levelNumber);
    if ((merged.courseId !== current.courseId || levelNumber !== current.levelNumber) && await tx.enrollment.count({ where: { trainingSessionId: id } })) throw structure.invalid('Formation et niveau verrouillés : cette session possède des inscriptions.');
    return tx.trainingSession.update({ where: { id }, data: { ...data, levelNumber } });
  });
}

function cancel(id) {
  return prisma.trainingSession.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });
}

function createRegistrationGroup(data) { return prisma.registrationGroup.create({ data }); }
function setRegistrationGroupActive(id, isActive) { return prisma.registrationGroup.update({ where: { id }, data: { isActive } }); }

module.exports = { list, findById, listCourses, findCourse, create, update, cancel, createRegistrationGroup, setRegistrationGroupActive };
