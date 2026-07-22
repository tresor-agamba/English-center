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
        include: { user: true },
        orderBy: { enrolledAt: 'desc' },
      },
    },
  });
}

function listCourses() {
  return prisma.course.findMany({ orderBy: { title: 'asc' } });
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

module.exports = { list, findById, listCourses, create, update, cancel };
