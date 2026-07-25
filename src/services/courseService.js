const prisma = require('../utils/prisma');

function list() {
  return prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { trainingSessions: true } } },
  });
}

function findById(id) {
  return prisma.course.findUnique({ where: { id } });
}

function findSlug(slug) {
  return prisma.course.findUnique({ where: { slug }, select: { id: true } });
}

function create(data) {
  return prisma.course.create({ data });
}

function update(id, data) {
  return prisma.course.update({ where: { id }, data });
}

function togglePublished(id, isPublished) {
  return prisma.course.update({ where: { id }, data: { isPublished } });
}

module.exports = { list, findById, findSlug, create, update, togglePublished };
