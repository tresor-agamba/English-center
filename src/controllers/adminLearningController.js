const service = require('../services/learningContentService');
const lmsCourseService = require('../services/lmsCourseService');
const lmsResourceService = require('../services/lmsResourceService');

function handle(error, res, view, data) {
  if (error instanceof service.LearningContentError) {
    return res.status(error.statusCode).render(view, { ...data, error: error.message });
  }
  throw error;
}

async function modules(req, res) {
  const course = await service.courseWithModules(req.params.courseId);
  if (!course) throw new service.LearningContentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  res.render('admin/modules/index', { title: `Contenu — ${course.title}`, course });
}

async function newModule(req, res) {
  const course = await service.courseWithModules(req.params.courseId);
  if (!course) throw new service.LearningContentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  res.render('admin/modules/new', { title: 'Nouveau module', course, form: { position: course.modules.length + 1 }, error: null });
}

async function createModule(req, res) {
  try {
    const item = await service.createModule(req.params.courseId, req.body);
    return res.redirect(`/admin/courses/${item.courseId}/modules`);
  } catch (error) {
    const course = await service.courseWithModules(req.params.courseId);
    return handle(error, res, 'admin/modules/new', { title: 'Nouveau module', course, form: req.body });
  }
}

async function editModule(req, res) {
  const module = await service.getModule(req.params.id);
  if (!module) throw new service.LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  res.render('admin/modules/edit', { title: `Modifier ${module.title}`, module, form: module, error: null });
}

async function updateModule(req, res) {
  try {
    const item = await service.updateModule(req.params.id, req.body);
    return res.redirect(`/admin/courses/${item.courseId}/modules`);
  } catch (error) {
    const module = await service.getModule(req.params.id);
    return handle(error, res, 'admin/modules/edit', { title: 'Modifier le module', module, form: req.body });
  }
}

async function moduleAction(req, res, action) {
  const module = await service.getModule(req.params.id);
  if (!module) throw new service.LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  await action(module.id);
  res.redirect(`/admin/courses/${module.courseId}/modules`);
}

async function newLesson(req, res) {
  const module = await service.getModule(req.params.moduleId);
  if (!module) throw new service.LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  res.render('admin/lessons/new', { title: 'Nouvelle leçon', module, form: { position: module.lessons.length + 1 }, error: null });
}

async function createLesson(req, res) {
  try {
    const lesson = await service.createLesson(req.params.moduleId, req.body);
    return res.redirect(`/admin/lessons/${lesson.id}/edit`);
  } catch (error) {
    const module = await service.getModule(req.params.moduleId);
    return handle(error, res, 'admin/lessons/new', { title: 'Nouvelle leçon', module, form: req.body });
  }
}

async function editLesson(req, res) {
  const lesson = await service.getLesson(req.params.id);
  if (!lesson) throw new service.LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  res.render('admin/lessons/edit', { title: `Modifier ${lesson.title}`, lesson, form: lesson, error: null });
}

async function updateLesson(req, res) {
  try {
    const lesson = await service.updateLesson(req.params.id, req.body);
    return res.redirect(`/admin/lessons/${lesson.id}/edit?updated=1`);
  } catch (error) {
    const lesson = await service.getLesson(req.params.id);
    return handle(error, res, 'admin/lessons/edit', { title: 'Modifier la leçon', lesson, form: req.body });
  }
}

async function lessonAction(req, res, action) {
  const lesson = await service.getLesson(req.params.id);
  if (!lesson) throw new service.LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  await action(lesson.id);
  res.redirect(`/admin/courses/${lesson.courseModule.courseId}/modules`);
}

async function newChapter(req, res) {
  const module = await service.getModule(req.params.moduleId);
  if (!module) throw new service.LearningContentError('MODULE_NOT_FOUND', 'Module introuvable.', 404);
  res.render('admin/chapters/form', { title: 'Nouveau chapitre', module, form: { position: module.chapters.length + 1 }, error: null, action: `/admin/modules/${module.id}/chapters`, submitLabel: 'Créer' });
}
async function createChapter(req, res) {
  const chapter = await service.createChapter(req.params.moduleId, req.body);
  res.redirect(`/admin/courses/${chapter.courseModuleId || (await service.getModule(req.params.moduleId)).courseId}/modules`);
}
async function editChapter(req, res) {
  const chapter = await service.getChapter(req.params.id);
  if (!chapter) throw new service.LearningContentError('CHAPTER_NOT_FOUND', 'Chapitre introuvable.', 404);
  res.render('admin/chapters/form', { title: `Modifier ${chapter.title}`, module: chapter.courseModule, form: chapter, error: null, action: `/admin/chapters/${chapter.id}`, submitLabel: 'Enregistrer' });
}
async function updateChapter(req, res) {
  const chapter = await service.updateChapter(req.params.id, req.body);
  res.redirect(`/admin/courses/${chapter.courseModuleId ? (await service.getModule(chapter.courseModuleId)).courseId : ''}/modules`);
}
async function chapterAction(req, res, action) {
  const chapter = await service.getChapter(req.params.id);
  if (!chapter) throw new service.LearningContentError('CHAPTER_NOT_FOUND', 'Chapitre introuvable.', 404);
  await action(chapter.id);
  res.redirect(`/admin/courses/${chapter.courseModule.courseId}/modules`);
}

const actorId = (req) => req.session.user.id;
async function reorderModules(req, res) {
  await lmsCourseService.reorder('courseModule', 'courseId', req.params.courseId, req.body.orderedIds, actorId(req), req.params.courseId);
  res.status(204).end();
}
async function reorderChapters(req, res) {
  const module = await service.getModule(req.params.moduleId);
  await lmsCourseService.reorder('courseChapter', 'courseModuleId', module.id, req.body.orderedIds, actorId(req), module.courseId);
  res.status(204).end();
}
async function reorderLessons(req, res) {
  const chapter = await service.getChapter(req.params.chapterId);
  await lmsCourseService.reorder('courseLesson', 'courseChapterId', chapter.id, req.body.orderedIds, actorId(req), chapter.courseModule.courseId);
  res.status(204).end();
}

async function resources(req, res) {
  const lesson = await service.getLesson(req.params.lessonId);
  if (!lesson) throw new service.LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  res.render('admin/resources/index', {
    title: `Ressources — ${lesson.title}`, lesson, resourceTypes: service.RESOURCE_TYPES,
    form: { position: lesson.resources.length + 1 }, error: null,
  });
}

async function createResource(req, res) {
  try {
    const resource = await service.createResource(req.params.lessonId, req.body);
    return res.redirect(`/admin/lessons/${resource.lessonId}/resources`);
  } catch (error) {
    const lesson = await service.getLesson(req.params.lessonId);
    return handle(error, res, 'admin/resources/index', {
      title: `Ressources — ${lesson?.title || ''}`, lesson, resourceTypes: service.RESOURCE_TYPES, form: req.body,
    });
  }
}
async function createPrivateResource(req, res) {
  const lesson = await service.getLesson(req.params.lessonId);
  if (!lesson) throw new service.LearningContentError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  await lmsResourceService.persist(req.file, lesson.id, req.body);
  res.redirect(`/admin/lessons/${lesson.id}/resources`);
}

async function updateResource(req, res) {
  const existing = await service.getResource(req.params.id);
  try {
    const resource = await service.updateResource(req.params.id, req.body);
    return res.redirect(`/admin/lessons/${resource.lessonId}/resources`);
  } catch (error) {
    if (!existing) throw error;
    const lesson = await service.getLesson(existing.lessonId);
    return handle(error, res, 'admin/resources/index', {
      title: `Ressources — ${lesson.title}`, lesson, resourceTypes: service.RESOURCE_TYPES, form: req.body,
    });
  }
}

async function resourceAction(req, res, action) {
  const resource = await service.getResource(req.params.id);
  if (!resource) throw new service.LearningContentError('RESOURCE_NOT_FOUND', 'Ressource introuvable.', 404);
  await action(resource.id);
  res.redirect(`/admin/lessons/${resource.lessonId}/resources`);
}

module.exports = {
  modules, newModule, createModule, editModule, updateModule,
  toggleModule: (req, res) => moduleAction(req, res, service.toggleModule),
  moveModuleUp: (req, res) => moduleAction(req, res, (id) => service.moveModule(id, 'up')),
  moveModuleDown: (req, res) => moduleAction(req, res, (id) => service.moveModule(id, 'down')),
  newChapter, createChapter, editChapter, updateChapter,
  toggleChapter: (req, res) => chapterAction(req, res, service.toggleChapter),
  moveChapterUp: (req, res) => chapterAction(req, res, (id) => service.moveChapter(id, 'up')),
  moveChapterDown: (req, res) => chapterAction(req, res, (id) => service.moveChapter(id, 'down')),
  newLesson, createLesson, editLesson, updateLesson,
  toggleLesson: (req, res) => lessonAction(req, res, service.toggleLesson),
  moveLessonUp: (req, res) => lessonAction(req, res, (id) => service.moveLesson(id, 'up')),
  moveLessonDown: (req, res) => lessonAction(req, res, (id) => service.moveLesson(id, 'down')),
  resources, createResource, createPrivateResource, updateResource,
  deleteResource: (req, res) => resourceAction(req, res, service.deleteResource),
  moveResourceUp: (req, res) => resourceAction(req, res, (id) => service.moveResource(id, 'up')),
  moveResourceDown: (req, res) => resourceAction(req, res, (id) => service.moveResource(id, 'down')),
  reorderModules, reorderChapters, reorderLessons,
};
