const prisma = require('../utils/prisma');
const notificationService = require('./notificationService');
const trialAccessService = require('./trialAccessService');

const FULL_ACCESS_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];
const OUTLINE_ACCESS_STATUSES = ['PAYMENT_REQUIRED'];
const MAX_ACTIVITY_INCREMENT_SECONDS = 300;

class LearningAccessError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.name = 'LearningAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function positiveId(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new LearningAccessError('INVALID_ID', `${label} invalide.`, 400);
  }
  return parsed;
}

function accessForStatus(status) {
  return {
    canViewOutline: FULL_ACCESS_STATUSES.includes(status) || OUTLINE_ACCESS_STATUSES.includes(status),
    canViewContent: FULL_ACCESS_STATUSES.includes(status),
    blocked: !FULL_ACCESS_STATUSES.includes(status),
  };
}

const isAvailable = (row, now) => row.isPublished && (!row.availableAt || row.availableAt <= now);
const lessonList = (modules) => modules.flatMap((module) => [
  ...module.lessons,
  ...module.chapters.flatMap((chapter) => chapter.lessons),
]).sort((a, b) => a.modulePosition - b.modulePosition
  || a.chapterPosition - b.chapterPosition || a.position - b.position);

function progressSummary(modules) {
  const lessons = lessonList(modules);
  const completedLessons = lessons.filter((lesson) => Boolean(lesson.lessonProgress[0]?.completedAt)).length;
  return {
    totalPublishedLessons: lessons.length,
    completedLessons,
    remainingLessons: lessons.length - completedLessons,
    progressPercentage: lessons.length ? Math.round((completedLessons / lessons.length) * 100) : 0,
    estimatedMinutes: lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes || 0), 0),
    nextLesson: lessons.find((lesson) => !lesson.lessonProgress[0]?.completedAt) || null,
  };
}

async function enrollmentForLearning(userId, enrollmentId) {
  const id = positiveId(enrollmentId, 'Inscription');
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, userId: positiveId(userId, 'Utilisateur') },
    select: {
      id: true,
      userId: true,
      status: true,
      trainingSession: {
        select: {
          id: true,
          name: true,
          timezone: true,
          course: {
            select: {
              id: true,
              title: true,
              lmsStatus: true,
              isPublished: true,
              modules: {
                orderBy: { position: 'asc' },
                include: {
                  prerequisiteModule: {
                    select: {
                      id: true,
                      lessons: { where: { isPublished: true }, select: { id: true } },
                      chapters: {
                        where: { isPublished: true },
                        select: { lessons: { where: { isPublished: true }, select: { id: true } } },
                      },
                    },
                  },
                  lessons: {
                    where: { courseChapterId: null },
                    orderBy: { position: 'asc' },
                    include: {
                      lessonProgress: { where: { enrollmentId: id }, take: 1 },
                    },
                  },
                  chapters: {
                    orderBy: { position: 'asc' },
                    include: {
                      lessons: {
                        orderBy: { position: 'asc' },
                        include: { lessonProgress: { where: { enrollmentId: id }, take: 1 } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!enrollment) throw new LearningAccessError('ENROLLMENT_NOT_FOUND', 'Inscription introuvable.', 404);
  if (!enrollment.trainingSession.course.isPublished
    || ['CLOSED', 'ARCHIVED'].includes(enrollment.trainingSession.course.lmsStatus)) {
    throw new LearningAccessError('COURSE_NOT_PUBLISHED', 'Ce cours n’est pas publié.', 403);
  }
  return { ...enrollment, courseAccess: await trialAccessService.calculateTrialAccess(enrollment.id) };
}

async function completedLessonIds(enrollmentId) {
  const rows = await prisma.lessonProgress.findMany({
    where: { enrollmentId, completedAt: { not: null } },
    select: { lessonId: true },
  });
  return new Set(rows.map((row) => row.lessonId));
}

function filterUnlockedModules(rawModules, completedIds, now = new Date()) {
  return rawModules.filter((module) => {
    if (!isAvailable(module, now)) return false;
    if (!module.prerequisiteModule) return true;
    const required = [
      ...module.prerequisiteModule.lessons.map((lesson) => lesson.id),
      ...module.prerequisiteModule.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => lesson.id)),
    ];
    return required.every((lessonId) => completedIds.has(lessonId));
  }).map((module) => ({
    id: module.id,
    title: module.title,
    description: module.description,
    position: module.position,
    lessons: module.lessons.filter((lesson) => isAvailable(lesson, now)).map((lesson) => ({
      ...lesson, modulePosition: module.position, chapterPosition: 0,
    })),
    chapters: module.chapters.filter((chapter) => isAvailable(chapter, now)).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      description: chapter.description,
      position: chapter.position,
      lessons: chapter.lessons.filter((lesson) => isAvailable(lesson, now)).map((lesson) => ({
        ...lesson, modulePosition: module.position, chapterPosition: chapter.position,
      })),
    })).filter((chapter) => chapter.lessons.length > 0),
  })).filter((module) => module.lessons.length > 0 || module.chapters.length > 0);
}

async function getLearningPath(userId, enrollmentId) {
  const enrollment = await enrollmentForLearning(userId, enrollmentId);
  const access = {
    canViewOutline: true,
    canViewContent: enrollment.courseAccess.allowed,
    blocked: !enrollment.courseAccess.allowed,
    ...enrollment.courseAccess,
  };
  if (!access.canViewOutline) throw new LearningAccessError('LEARNING_BLOCKED', 'Cette inscription ne permet pas d’accéder au contenu.', 403);
  const completedIds = await completedLessonIds(enrollment.id);
  const course = enrollment.trainingSession.course;
  const modules = filterUnlockedModules(course.modules, completedIds);
  modules.forEach((module) => {
    module.completedLessons = [...module.lessons, ...module.chapters.flatMap((chapter) => chapter.lessons)]
      .filter((lesson) => lesson.lessonProgress[0]?.completedAt).length;
  });
  return { enrollment, course: { id: course.id, title: course.title }, modules, access, progress: progressSummary(modules) };
}

async function getLesson(userId, enrollmentId, lessonId) {
  const path = await getLearningPath(userId, enrollmentId);
  if (!path.access.canViewContent) throw new LearningAccessError('CONTENT_BLOCKED', 'Le contenu est réservé aux inscriptions actives.', 403);
  const lessons = lessonList(path.modules);
  const index = lessons.findIndex((lesson) => lesson.id === positiveId(lessonId, 'Leçon'));
  if (index < 0) throw new LearningAccessError('LESSON_NOT_FOUND', 'Leçon introuvable ou non déverrouillée.', 404);
  const lesson = await prisma.courseLesson.findUnique({
    where: { id: lessons[index].id },
    select: {
      id: true, title: true, description: true, content: true, type: true, externalUrl: true,
      estimatedMinutes: true, completionRule: true, assessmentId: true,
      assessment: { select: { id: true, mode: true, status: true } },
      resources: {
        orderBy: { position: 'asc' },
        select: { publicId: true, title: true, type: true, url: true, isPrivate: true },
      },
      lessonProgress: { where: { enrollmentId: path.enrollment.id }, take: 1 },
    },
  });
  const now = new Date();
  await prisma.lessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: path.enrollment.id, lessonId: lesson.id } },
    create: { enrollmentId: path.enrollment.id, lessonId: lesson.id, openedAt: now, lastOpenedAt: now },
    update: { lastOpenedAt: now },
  });
  return { ...path, lesson, previousLesson: lessons[index - 1] || null, nextLesson: lessons[index + 1] || null };
}

async function assessmentRequirementSatisfied(lesson, enrollmentId) {
  if (lesson.completionRule === 'IMMEDIATE') return true;
  if (!lesson.assessmentId) return false;
  const attempt = await prisma.assessmentAttempt.findFirst({
    where: {
      assessmentId: lesson.assessmentId,
      enrollmentId,
      status: { in: ['SUBMITTED', 'GRADED', 'RETURNED'] },
    },
    orderBy: { attemptNumber: 'desc' },
    include: { evaluation: { select: { status: true, decision: true } } },
  });
  if (lesson.completionRule === 'AFTER_ASSESSMENT_SUBMISSION') return Boolean(attempt);
  return attempt?.evaluation?.status === 'PUBLISHED' && attempt.evaluation.decision === 'PASSED';
}

async function notifyNextLesson(path, completedLessonId) {
  const lessons = lessonList(path.modules);
  const next = lessons[lessons.findIndex((lesson) => lesson.id === completedLessonId) + 1];
  if (!next) return;
  await notificationService.createNotificationsForUsers([path.enrollment.userId].filter(Boolean), {
    type: 'LESSON_AVAILABLE',
    title: 'Nouvelle leçon disponible',
    message: next.title,
    actionUrl: `/student/courses/${path.enrollment.id}/lessons/${next.id}`,
    relatedEntity: 'COURSE_LESSON',
    relatedId: next.id,
  }, `LESSON_AVAILABLE:enrollment-${path.enrollment.id}:lesson-${next.id}`);
}

async function setCompleted(userId, enrollmentId, lessonId, completed = true) {
  const data = await getLesson(userId, enrollmentId, lessonId);
  if (completed && !(await assessmentRequirementSatisfied(data.lesson, data.enrollment.id))) {
    throw new LearningAccessError('ASSESSMENT_REQUIRED', 'L’évaluation liée doit être soumise ou réussie avant de terminer cette leçon.', 409);
  }
  const now = new Date();
  await prisma.lessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: data.enrollment.id, lessonId: data.lesson.id } },
    create: { enrollmentId: data.enrollment.id, lessonId: data.lesson.id, openedAt: now, lastOpenedAt: now, completedAt: completed ? now : null },
    update: { completedAt: completed ? now : null, lastOpenedAt: now },
  });
  return data;
}

async function recordActivity(userId, enrollmentId, lessonId, lastPositionSeconds = 0) {
  const progress = await prisma.lessonProgress.findUnique({
    where: {
      enrollmentId_lessonId: {
        enrollmentId: positiveId(enrollmentId, 'Inscription'),
        lessonId: positiveId(lessonId, 'Leçon'),
      },
    },
  });
  const now = new Date();
  const elapsed = progress?.lastOpenedAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(progress.lastOpenedAt).getTime()) / 1000))
    : 0;
  const data = await getLesson(userId, enrollmentId, lessonId);
  const increment = Math.min(elapsed, MAX_ACTIVITY_INCREMENT_SECONDS);
  const position = Math.max(0, Math.min(Number(lastPositionSeconds) || 0, 86400));
  return prisma.lessonProgress.update({
    where: { enrollmentId_lessonId: { enrollmentId: data.enrollment.id, lessonId: data.lesson.id } },
    data: { timeSpentSeconds: { increment }, lastPositionSeconds: position, lastOpenedAt: now },
  });
}

module.exports = {
  FULL_ACCESS_STATUSES, OUTLINE_ACCESS_STATUSES, MAX_ACTIVITY_INCREMENT_SECONDS,
  LearningAccessError, accessForStatus, progressSummary, getLearningPath, getLesson,
  setCompleted, recordActivity, filterUnlockedModules, assessmentRequirementSatisfied,
};
