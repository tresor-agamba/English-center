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

function create(data) {
  return prisma.trainingSession.create({ data });
}

function update(id, data) {
  return prisma.trainingSession.update({ where: { id }, data });
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
