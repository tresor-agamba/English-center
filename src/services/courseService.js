const prisma = require('../utils/prisma');
const { publicationMissingFields, publicationState } = require('./coursePublicationPolicy');
const { OCCUPYING_ENROLLMENT_STATUSES, sessionRegistrationState } = require('./enrollmentPolicy');

const registrationSessions = {
  orderBy: { startDate: 'asc' },
  select: {
    status: true, startDate: true, registrationDeadline: true, capacity: true,
    _count: { select: { enrollments: { where: { status: { in: OCCUPYING_ENROLLMENT_STATUSES } } } } },
  },
};

function list() {
  return prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { trainingSessions: true } }, trainingSessions: registrationSessions },
  });
}

function findById(id) {
  return prisma.course.findUnique({ where: { id }, include: { trainingSessions: registrationSessions } });
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
  const state = publicationState(course);
  let publicRegistrationState = state === 'ARCHIVED' ? 'ARCHIVED' : 'READY';
  if (state === 'PUBLISHED') {
    const sessionStates = (course.trainingSessions || []).map((session) => sessionRegistrationState(session));
    if (sessionStates.includes('OPEN')) publicRegistrationState = 'OPEN';
    else if (sessionStates.includes('FULL')) publicRegistrationState = 'FULL';
    else if (sessionStates.includes('CLOSED')) publicRegistrationState = 'CLOSED';
    else publicRegistrationState = 'NO_OPEN_SESSION';
  }
  return { ...course, publicationState: state, publicationMissingFields: publicationMissingFields(course), publicRegistrationState };
}

module.exports = { list, findById, findSlug, create, update, publish, unpublish, archive, decoratePublication };
