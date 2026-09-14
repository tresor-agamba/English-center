const structure = require('./courseStructureService');
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
  return prisma.course.create({ data: { ...data, ...structure.parseStructure(data) } });
}

async function update(id, data) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM courses WHERE id = ${id} FOR UPDATE`;
    const current = await tx.course.findUniqueOrThrow({ where: { id } });
    const merged = { ...current, ...data };
    const parsed = structure.parseStructure(merged);
    if (merged.numberOfLevels !== current.numberOfLevels && await tx.academicCohort.count({ where: { courseId: id } })) throw structure.invalid('Modification refusée : le nombre de niveaux est verrouillé par les cohortes académiques existantes. Créez une nouvelle formation pour ce parcours afin de conserver leur historique.');
    const changed = ['structureType', 'sessionCount', 'accessPolicy'].some(key => merged[key] !== current[key]);
    if (changed && (await tx.enrollment.count({ where: { trainingSession: { courseId: id } } }) || await tx.academicCohort.count({ where: { courseId: id } }))) {
      throw structure.invalid('Modification refusée : structure et règle d’accès verrouillées car des inscriptions ou cohortes existent. Créez une nouvelle formation pour ce parcours afin de conserver leur historique.');
    }
    const sessions = await tx.trainingSession.findMany({ where: { courseId: id }, orderBy: { id: 'asc' }, select: { id: true, name: true, levelNumber: true } });
    for (const session of sessions) {
      try {
        structure.validateSessionLevel(merged, session.levelNumber);
      } catch (error) {
        if (error.statusCode !== 400) throw error;
        const reason = structure.isLevelBased(merged) && session.levelNumber == null
          ? 'elle ne possède pas de numéro de niveau, obligatoire pour une formation par niveaux'
          : error.message;
        throw structure.invalid(`Modification refusée : la session existante « ${session.name} » (#${session.id}) est incompatible avec la structure demandée : ${reason}. Créez une nouvelle formation pour ce parcours afin de conserver les sessions historiques.`);
      }
    }
    return tx.course.update({ where: { id }, data: { ...data, ...parsed } });
  });
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
