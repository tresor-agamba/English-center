const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const notifications = require('./notificationService');
const { sanitizeRichText } = require('./lmsSanitizationService');

class LmsError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const id = (value, label = 'élément') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new LmsError('INVALID_ID', `Identifiant de ${label} invalide.`);
  return parsed;
};
const text = (value, label, max = 200) => {
  const result = String(value || '').trim();
  if (!result || result.length > max) throw new LmsError('INVALID_TEXT', `${label} est invalide.`);
  return result;
};
function slug(value) {
  const result = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!result) throw new LmsError('INVALID_SLUG', 'Le slug est invalide.');
  return result;
}

async function actor(actorId, client = prisma) {
  const user = await client.user.findUnique({ where: { id: id(actorId, 'acteur') }, select: { id: true, role: true, isActive: true } });
  if (!user?.isActive || !['ADMIN', 'TEACHER'].includes(user.role)) throw new LmsError('ACCESS_DENIED', 'Accès interdit.', 403);
  return user;
}
async function requireManager(actorId, courseId, client = prisma) {
  const [user, course] = await Promise.all([
    actor(actorId, client),
    client.course.findUnique({ where: { id: id(courseId, 'cours') } }),
  ]);
  if (!course) throw new LmsError('COURSE_NOT_FOUND', 'Cours introuvable.', 404);
  if (user.role === 'TEACHER' && course.createdById !== user.id) {
    const assigned = await client.trainingSessionTeacher.findFirst({ where: { teacherId: user.id, trainingSession: { courseId: course.id } }, select: { id: true } });
    if (!assigned) throw new LmsError('ACCESS_DENIED', 'Vous ne gérez pas ce cours.', 403);
  }
  return { user, course };
}
function courseData(body) {
  return {
    title: text(body.title, 'Le titre'),
    slug: slug(body.slug || body.title),
    shortDescription: body.shortDescription ? text(body.shortDescription, 'La description courte', 500) : null,
    description: sanitizeRichText(body.description, 20000),
    level: body.level ? text(body.level, 'Le niveau', 100) : null,
  };
}
async function create(body, actorId) {
  const user = await actor(actorId);
  try {
    return await prisma.course.create({ data: { ...courseData(body), createdById: user.id, lmsStatus: 'DRAFT', isPublished: false } });
  } catch (error) {
    if (error.code === 'P2002') throw new LmsError('SLUG_TAKEN', 'Ce slug est déjà utilisé.', 409);
    throw error;
  }
}
async function update(courseId, body, actorId) {
  const { course } = await requireManager(actorId, courseId);
  if (course.lmsStatus === 'ARCHIVED') throw new LmsError('COURSE_ARCHIVED', 'Un cours archivé ne peut plus être modifié.', 409);
  const updated = await prisma.course.update({ where: { id: course.id }, data: courseData(body) });
  if (course.lmsStatus === 'PUBLISHED') await notify(course.id, 'COURSE_UPDATED', 'Cours mis à jour');
  return updated;
}
async function notify(courseId, type, title) {
  const enrollments = await prisma.enrollment.findMany({ where: { trainingSession: { courseId }, status: { in: ['TRIAL_ACTIVE', 'CONFIRMED'] } }, select: { userId: true } });
  return notifications.createNotificationsForUsers(enrollments.map(row => row.userId), {
    type, title, message: title, actionUrl: '/student/learning', relatedEntity: 'COURSE', relatedId: courseId,
  }, `${type}:course-${courseId}`);
}
async function transition(courseId, actorId, status) {
  const { course } = await requireManager(actorId, courseId);
  const allowed = { DRAFT: ['PUBLISHED', 'ARCHIVED'], PUBLISHED: ['CLOSED', 'ARCHIVED'], CLOSED: ['PUBLISHED', 'ARCHIVED'], ARCHIVED: [] };
  if (!allowed[course.lmsStatus].includes(status)) throw new LmsError('INVALID_TRANSITION', 'Transition de cours invalide.', 409);
  const now = new Date();
  const updated = await prisma.course.update({
    where: { id: course.id },
    data: {
      lmsStatus: status, isPublished: status === 'PUBLISHED',
      ...(status === 'PUBLISHED' ? { publishedAt: now, closedAt: null } : {}),
      ...(status === 'CLOSED' ? { closedAt: now } : {}),
      ...(status === 'ARCHIVED' ? { archivedAt: now } : {}),
    },
  });
  if (status === 'PUBLISHED') await notify(course.id, 'COURSE_PUBLISHED', 'Cours publié');
  if (status === 'ARCHIVED') await notify(course.id, 'COURSE_ARCHIVED', 'Cours archivé');
  return updated;
}
async function detail(courseId, actorId) {
  await requireManager(actorId, courseId);
  return prisma.course.findUnique({
    where: { id: id(courseId) },
    include: {
      modules: {
        orderBy: { position: 'asc' },
        include: {
          chapters: { orderBy: { position: 'asc' }, include: { lessons: { orderBy: { position: 'asc' }, include: { resources: true, assessment: { select: { id: true, title: true, mode: true } } } } } },
          lessons: { where: { courseChapterId: null }, orderBy: { position: 'asc' }, include: { resources: true, assessment: { select: { id: true, title: true, mode: true } } } },
        },
      },
    },
  });
}
function list(actorId, role) {
  return prisma.course.findMany({
    where: role === 'TEACHER' ? { OR: [{ createdById: actorId }, { trainingSessions: { some: { teachers: { some: { teacherId: actorId } } } } }] } : {},
    include: { _count: { select: { modules: true, trainingSessions: true } } },
    orderBy: { createdAt: 'desc' },
  });
}
async function duplicate(courseId, actorId) {
  const source = await detail(courseId, actorId);
  const user = await actor(actorId);
  return prisma.$transaction(async tx => {
    let nextSlug = `${source.slug}-copie`;
    let suffix = 2;
    while (await tx.course.findUnique({ where: { slug: nextSlug }, select: { id: true } })) nextSlug = `${source.slug}-copie-${suffix++}`;
    const copy = await tx.course.create({
      data: {
        title: `${source.title} (copie)`, slug: nextSlug, description: source.description,
        shortDescription: source.shortDescription, level: source.level, courseType: source.courseType,
        objectives: source.objectives, targetAudience: source.targetAudience, prerequisites: source.prerequisites,
        createdById: user.id, lmsStatus: 'DRAFT', isPublished: false,
      },
    });
    const moduleMap = new Map();
    const chapterMap = new Map();
    for (const module of source.modules) {
      const createdModule = await tx.courseModule.create({ data: { courseId: copy.id, title: module.title, description: module.description, position: module.position, isPublished: false } });
      moduleMap.set(module.id, createdModule.id);
      for (const chapter of module.chapters) {
        const createdChapter = await tx.courseChapter.create({ data: { courseModuleId: createdModule.id, title: chapter.title, description: chapter.description, position: chapter.position, isPublished: false } });
        chapterMap.set(chapter.id, createdChapter.id);
        for (const lesson of chapter.lessons) await copyLesson(tx, lesson, createdModule.id, createdChapter.id);
      }
      for (const lesson of module.lessons) await copyLesson(tx, lesson, createdModule.id, null);
    }
    for (const module of source.modules) if (module.prerequisiteModuleId) {
      await tx.courseModule.update({ where: { id: moduleMap.get(module.id) }, data: { prerequisiteModuleId: moduleMap.get(module.prerequisiteModuleId) || null } });
    }
    return copy;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
async function copyLesson(tx, lesson, moduleId, chapterId) {
  const copy = await tx.courseLesson.create({
    data: {
      courseModuleId: moduleId, courseChapterId: chapterId, assessmentId: lesson.assessmentId,
      type: lesson.type, completionRule: lesson.completionRule, title: lesson.title, description: lesson.description,
      content: lesson.content, position: lesson.position, estimatedMinutes: lesson.estimatedMinutes, isPublished: false,
    },
  });
  if (lesson.resources.length) await tx.lessonResource.createMany({
    data: lesson.resources.map(resource => ({
      lessonId: copy.id, title: resource.title, type: resource.type, url: resource.url,
      storageKey: resource.storageKey, mimeType: resource.mimeType, originalFileName: resource.originalFileName,
      sizeBytes: resource.sizeBytes, isPrivate: resource.isPrivate, position: resource.position,
    })),
  });
}
async function reorder(model, parentField, parentId, orderedIds, actorId, courseId) {
  await requireManager(actorId, courseId);
  const ids = Array.isArray(orderedIds) ? orderedIds.map(value => id(value)) : [];
  if (!ids.length || new Set(ids).size !== ids.length) throw new LmsError('INVALID_ORDER', 'Ordre invalide.');
  return prisma.$transaction(async tx => {
    const rows = await tx[model].findMany({ where: { [parentField]: id(parentId) }, select: { id: true } });
    if (rows.length !== ids.length || rows.some(row => !ids.includes(row.id))) throw new LmsError('INVALID_ORDER_SCOPE', 'La réorganisation doit contenir tous les éléments du même parent.');
    await Promise.all(ids.map((rowId, index) => tx[model].update({ where: { id: rowId }, data: { position: -(index + 1) } })));
    for (let index = 0; index < ids.length; index += 1) await tx[model].update({ where: { id: ids[index] }, data: { position: index + 1 } });
    return ids;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

module.exports = { LmsError, id, courseData, actor, requireManager, create, update, transition, detail, list, duplicate, reorder };
