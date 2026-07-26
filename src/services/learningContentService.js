const prisma = require('../utils/prisma');

const RESOURCE_TYPES = ['PDF', 'VIDEO_LINK', 'EXTERNAL_LINK', 'DOCUMENT'];

class LearningContentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'LearningContentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function id(value, label = 'élément') {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LearningContentError('INVALID_ID', `Identifiant de ${label} invalide.`);
  }
  return parsed;
}

function position(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LearningContentError('INVALID_POSITION', 'La position doit être un entier positif.');
  }
  return parsed;
}

function text(value, field, max = 500) {
  const parsed = value?.trim() || '';
  if (!parsed) throw new LearningContentError('REQUIRED_FIELD', `${field} est obligatoire.`);
  if (parsed.length > max) throw new LearningContentError('FIELD_TOO_LONG', `${field} est trop long.`);
  return parsed;
}

function optionalText(value, max) {
  const parsed = value?.trim() || null;
  if (parsed && parsed.length > max) throw new LearningContentError('FIELD_TOO_LONG', 'Le contenu est trop long.');
  return parsed;
}

function moduleData(body) {
  return {
    title: text(body.title, 'Le titre', 180),
    description: optionalText(body.description, 2000),
    position: position(body.position),
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
  };
}

function lessonData(body) {
  const estimatedMinutes = body.estimatedMinutes ? Number(body.estimatedMinutes) : null;
  if (estimatedMinutes !== null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
    throw new LearningContentError('INVALID_DURATION', 'La durée estimée doit être un entier positif.');
  }
  return {
    title: text(body.title, 'Le titre', 180),
    description: optionalText(body.description, 2000),
    content: optionalText(body.content, 50000),
    position: position(body.position),
    estimatedMinutes,
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
  };
}

function resourceData(body) {
  const type = body.type;
  if (!RESOURCE_TYPES.includes(type)) throw new LearningContentError('INVALID_RESOURCE_TYPE', 'Type de ressource invalide.');
  let url;
  try {
    url = new URL(body.url);
  } catch {
    throw new LearningContentError('INVALID_URL', 'L’URL de la ressource est invalide.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new LearningContentError('INVALID_URL', 'Seules les URL HTTP ou HTTPS sont autorisées.');
  }
  return {
    title: text(body.title, 'Le titre', 180),
    type,
    url: url.toString(),
    position: position(body.position),
  };
}

async function courseWithModules(courseId) {
  return prisma.course.findUnique({
    where: { id: id(courseId, 'formation') },
    select: {
      id: true, title: true,
      modules: {
        orderBy: { position: 'asc' },
        include: {
          lessons: {
            orderBy: { position: 'asc' },
            include: { _count: { select: { resources: true } } },
          },
          _count: { select: { lessons: true } },
        },
      },
    },
  });
}

async function getModule(moduleId) {
  return prisma.courseModule.findUnique({
    where: { id: id(moduleId, 'module') },
    include: { course: true, lessons: { orderBy: { position: 'asc' }, include: { _count: { select: { resources: true } } } } },
  });
}

async function createModule(courseId, body) {
  const course = await prisma.course.findUnique({ where: { id: id(courseId, 'formation') }, select: { id: true } });
  if (!course) throw new LearningContentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  try {
    return await prisma.courseModule.create({ data: { courseId: course.id, ...moduleData(body) } });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function updateModule(moduleId, body) {
  const current = await getModule(moduleId);
  if (!current) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  try {
    return await prisma.courseModule.update({ where: { id: current.id }, data: moduleData(body) });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function toggleModule(moduleId) {
  const current = await getModule(moduleId);
  if (!current) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  return prisma.courseModule.update({ where: { id: current.id }, data: { isPublished: !current.isPublished } });
}

async function getLesson(lessonId) {
  return prisma.lesson.findUnique({
    where: { id: id(lessonId, 'leçon') },
    include: { courseModule: { include: { course: true } }, resources: { orderBy: { position: 'asc' } } },
  });
}

async function createLesson(moduleId, body) {
  const module = await getModule(moduleId);
  if (!module) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  try {
    return await prisma.lesson.create({ data: { courseModuleId: module.id, ...lessonData(body) } });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function updateLesson(lessonId, body) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  try {
    return await prisma.lesson.update({ where: { id: lesson.id }, data: lessonData(body) });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function toggleLesson(lessonId) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  return prisma.lesson.update({ where: { id: lesson.id }, data: { isPublished: !lesson.isPublished } });
}

async function swap(model, currentId, parentField, parentId, direction) {
  return prisma.$transaction(async (tx) => {
    const current = await tx[model].findUnique({ where: { id: currentId } });
    if (!current) throw new LearningContentError('NOT_FOUND', 'Élément introuvable.', 404);
    const sibling = await tx[model].findFirst({
      where: {
        [parentField]: parentId,
        position: direction === 'up' ? { lt: current.position } : { gt: current.position },
      },
      orderBy: { position: direction === 'up' ? 'desc' : 'asc' },
    });
    if (!sibling) return current;
    await tx[model].update({ where: { id: current.id }, data: { position: -current.id } });
    await tx[model].update({ where: { id: sibling.id }, data: { position: current.position } });
    return tx[model].update({ where: { id: current.id }, data: { position: sibling.position } });
  });
}

async function moveModule(moduleId, direction) {
  const module = await getModule(moduleId);
  if (!module) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  return swap('courseModule', module.id, 'courseId', module.courseId, direction);
}

async function moveLesson(lessonId, direction) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  return swap('lesson', lesson.id, 'courseModuleId', lesson.courseModuleId, direction);
}

async function createResource(lessonId, body) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  try {
    return await prisma.lessonResource.create({ data: { lessonId: lesson.id, ...resourceData(body) } });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function getResource(resourceId) {
  return prisma.lessonResource.findUnique({ where: { id: id(resourceId, 'ressource') } });
}

async function updateResource(resourceId, body) {
  const resource = await getResource(resourceId);
  if (!resource) throw new LearningContentError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  try {
    return await prisma.lessonResource.update({ where: { id: resource.id }, data: resourceData(body) });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function deleteResource(resourceId) {
  const resource = await getResource(resourceId);
  if (!resource) throw new LearningContentError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  await prisma.lessonResource.delete({ where: { id: resource.id } });
  return resource;
}

async function moveResource(resourceId, direction) {
  const resource = await getResource(resourceId);
  if (!resource) throw new LearningContentError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  return swap('lessonResource', resource.id, 'lessonId', resource.lessonId, direction);
}

module.exports = {
  RESOURCE_TYPES, LearningContentError, moduleData, lessonData, resourceData,
  courseWithModules, getModule, createModule, updateModule, toggleModule, moveModule,
  getLesson, createLesson, updateLesson, toggleLesson, moveLesson,
  getResource, createResource, updateResource, deleteResource, moveResource,
};
