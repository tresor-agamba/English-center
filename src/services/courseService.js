const prisma = require('../utils/prisma');
const { publicationMissingFields, publicationState } = require('./coursePublicationPolicy');

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

async function publish(id) {
  const course = await findById(id);
  const missing = publicationMissingFields(course || {});
  if (!course || missing.length) {
    const error = new Error(`Publication refusée. Informations manquantes : ${missing.join(', ') || 'formation introuvable'}.`);
    error.statusCode = course ? 400 : 404;
    error.missingFields = missing;
    throw error;
  }
  return prisma.course.update({ where: { id }, data: {
    isPublished: true, lmsStatus: 'PUBLISHED', publishedAt: new Date(), closedAt: null, archivedAt: null,
  } });
}

function unpublish(id) {
  return prisma.course.update({ where: { id }, data: { isPublished: false, lmsStatus: 'DRAFT', publishedAt: null } });
}

function archive(id) {
  return prisma.course.update({ where: { id }, data: { isPublished: false, lmsStatus: 'ARCHIVED', archivedAt: new Date() } });
}

function decoratePublication(course) {
  return { ...course, publicationState: publicationState(course), publicationMissingFields: publicationMissingFields(course) };
}

module.exports = { list, findById, findSlug, create, update, publish, unpublish, archive, decoratePublication };
