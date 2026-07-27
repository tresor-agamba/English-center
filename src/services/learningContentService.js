const prisma = require('../utils/prisma');
const { sanitizeRichText } = require('./lmsSanitizationService');

const RESOURCE_TYPES = ['PDF', 'VIDEO_LINK', 'EXTERNAL_LINK', 'DOCUMENT'];
const LESSON_TYPES = ['TEXT', 'VIDEO', 'PDF', 'AUDIO', 'LINK', 'DOWNLOAD', 'EMBED', 'LIVE_SESSION'];
const COMPLETION_RULES = ['IMMEDIATE', 'AFTER_ASSESSMENT_SUBMISSION', 'AFTER_ASSESSMENT_PASS'];

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

function optionalDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new LearningContentError('INVALID_DATE', 'La date est invalide.');
  return parsed;
}

function optionalHttpUrl(value, required = false) {
  if (!value && !required) return null;
  let parsed;
  try { parsed = new URL(value); } catch { throw new LearningContentError('INVALID_URL', 'Le lien est invalide.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new LearningContentError('INVALID_URL', 'Seuls les protocoles HTTP et HTTPS sont autorisés.');
  }
  return parsed.toString();
}

function moduleData(body) {
  return {
    title: text(body.title, 'Le titre', 180),
    description: optionalText(body.description, 2000),
    position: position(body.position),
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
    availableAt: optionalDate(body.availableAt),
    prerequisiteModuleId: body.prerequisiteModuleId ? id(body.prerequisiteModuleId, 'prérequis') : null,
  };
}

function lessonData(body) {
  const estimatedMinutes = body.estimatedMinutes ? Number(body.estimatedMinutes) : null;
  if (estimatedMinutes !== null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0)) {
    throw new LearningContentError('INVALID_DURATION', 'La durée estimée doit être un entier positif.');
  }
  const type = LESSON_TYPES.includes(body.type) ? body.type : 'TEXT';
  const requiresUrl = ['LINK', 'EMBED', 'LIVE_SESSION'].includes(type);
  return {
    title: text(body.title, 'Le titre', 180),
    description: optionalText(body.description, 2000),
    content: sanitizeRichText(body.content, 100000),
    position: position(body.position),
    estimatedMinutes,
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
    type,
    externalUrl: optionalHttpUrl(body.externalUrl, requiresUrl),
    courseChapterId: body.courseChapterId ? id(body.courseChapterId, 'chapitre') : null,
    assessmentId: body.assessmentId ? id(body.assessmentId, 'évaluation') : null,
    completionRule: COMPLETION_RULES.includes(body.completionRule) ? body.completionRule : 'IMMEDIATE',
    availableAt: optionalDate(body.availableAt),
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
          chapters: {
            orderBy: { position: 'asc' },
            include: { lessons: { orderBy: { position: 'asc' }, include: { _count: { select: { resources: true } } } } },
          },
          lessons: {
            where: { courseChapterId: null },
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
    include: { course: true, chapters: { orderBy: { position: 'asc' } }, lessons: { orderBy: { position: 'asc' }, include: { _count: { select: { resources: true } } } } },
  });
}

async function createModule(courseId, body) {
  const course = await prisma.course.findUnique({ where: { id: id(courseId, 'formation') }, select: { id: true } });
  if (!course) throw new LearningContentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  try {
    const data = moduleData(body);
    if (data.prerequisiteModuleId) {
      const prerequisite = await prisma.courseModule.findFirst({ where: { id: data.prerequisiteModuleId, courseId: course.id } });
      if (!prerequisite) throw new LearningContentError('INVALID_PREREQUISITE', 'Prérequis invalide.');
    }
    return await prisma.courseModule.create({ data: { courseId: course.id, ...data } });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function updateModule(moduleId, body) {
  const current = await getModule(moduleId);
  if (!current) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  try {
    const data = moduleData(body);
    if (data.prerequisiteModuleId === current.id) throw new LearningContentError('INVALID_PREREQUISITE', 'Un module ne peut pas dépendre de lui-même.');
    if (data.prerequisiteModuleId) {
      const prerequisite = await prisma.courseModule.findFirst({ where: { id: data.prerequisiteModuleId, courseId: current.courseId } });
      if (!prerequisite || prerequisite.prerequisiteModuleId === current.id) throw new LearningContentError('INVALID_PREREQUISITE', 'Prérequis invalide ou cyclique.');
    }
    return await prisma.courseModule.update({ where: { id: current.id }, data });
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
  return prisma.courseLesson.findUnique({
    where: { id: id(lessonId, 'leçon') },
    include: { courseModule: { include: { course: true, chapters: true } }, courseChapter: true, assessment: true, resources: { orderBy: { position: 'asc' } } },
  });
}

async function createLesson(moduleId, body) {
  const module = await getModule(moduleId);
  if (!module) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  try {
    const data = lessonData(body);
    await validateLessonRelations(module, data);
    return await prisma.courseLesson.create({ data: { courseModuleId: module.id, ...data } });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function updateLesson(lessonId, body) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  try {
    const data = lessonData(body);
    await validateLessonRelations(lesson.courseModule, data);
    return await prisma.courseLesson.update({ where: { id: lesson.id }, data });
  } catch (error) {
    if (error.code === 'P2002') throw new LearningContentError('POSITION_TAKEN', 'Cette position est déjà utilisée.');
    throw error;
  }
}

async function toggleLesson(lessonId) {
  const lesson = await getLesson(lessonId);
  if (!lesson) throw new LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  return prisma.courseLesson.update({ where: { id: lesson.id }, data: { isPublished: !lesson.isPublished } });
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
  return swap('courseLesson', lesson.id, lesson.courseChapterId ? 'courseChapterId' : 'courseModuleId', lesson.courseChapterId || lesson.courseModuleId, direction);
}

async function validateLessonRelations(module, data) {
  if (data.courseChapterId && !module.chapters.some(chapter => chapter.id === data.courseChapterId)) {
    throw new LearningContentError('INVALID_CHAPTER', 'Le chapitre ne correspond pas au module.');
  }
  if (data.assessmentId) {
    const assessment = await prisma.assessment.findFirst({ where: { id: data.assessmentId, courseId: module.courseId } });
    if (!assessment) throw new LearningContentError('INVALID_ASSESSMENT', 'L’évaluation doit appartenir au même cours.');
  }
  if (data.completionRule !== 'IMMEDIATE' && !data.assessmentId) {
    throw new LearningContentError('ASSESSMENT_REQUIRED', 'Cette règle de complétion exige une évaluation.');
  }
}

function chapterData(body) {
  return {
    title: text(body.title, 'Le titre', 180),
    description: optionalText(body.description, 2000),
    position: position(body.position),
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
    availableAt: optionalDate(body.availableAt),
  };
}
async function getChapter(value) {
  return prisma.courseChapter.findUnique({ where: { id: id(value, 'chapitre') }, include: { courseModule: { include: { course: true } }, lessons: { orderBy: { position: 'asc' } } } });
}
async function createChapter(moduleId, body) {
  const module = await getModule(moduleId);
  if (!module) throw new LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  return prisma.courseChapter.create({ data: { courseModuleId: module.id, ...chapterData(body) } });
}
async function updateChapter(value, body) {
  const chapter = await getChapter(value);
  if (!chapter) throw new LearningContentError('CHAPTER_NOT_FOUND', 'Chapitre introuvable.', 404);
  return prisma.courseChapter.update({ where: { id: chapter.id }, data: chapterData(body) });
}
async function toggleChapter(value) {
  const chapter = await getChapter(value);
  if (!chapter) throw new LearningContentError('CHAPTER_NOT_FOUND', 'Chapitre introuvable.', 404);
  return prisma.courseChapter.update({ where: { id: chapter.id }, data: { isPublished: !chapter.isPublished } });
}
async function moveChapter(value, direction) {
  const chapter = await getChapter(value);
  if (!chapter) throw new LearningContentError('CHAPTER_NOT_FOUND', 'Chapitre introuvable.', 404);
  return swap('courseChapter', chapter.id, 'courseModuleId', chapter.courseModuleId, direction);
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
  RESOURCE_TYPES, LESSON_TYPES, COMPLETION_RULES, LearningContentError, moduleData, lessonData, resourceData,
  courseWithModules, getModule, createModule, updateModule, toggleModule, moveModule,
  getChapter, createChapter, updateChapter, toggleChapter, moveChapter,
  getLesson, createLesson, updateLesson, toggleLesson, moveLesson,
  getResource, createResource, updateResource, deleteResource, moveResource,
};
