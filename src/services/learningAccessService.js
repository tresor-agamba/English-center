const prisma = require('../utils/prisma');

const FULL_ACCESS_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];
const OUTLINE_ACCESS_STATUSES = ['PAYMENT_REQUIRED'];

class LearningAccessError extends Error {
  constructor(code, message, statusCode = 403) {
    super(message);
    this.name = 'LearningAccessError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function enrollmentForLearning(userId, enrollmentId) {
  const id = Number(enrollmentId);
  if (!Number.isInteger(id) || id <= 0) throw new LearningAccessError('ENROLLMENT_NOT_FOUND', 'Inscription introuvable.', 404);
  const enrollment = await prisma.enrollment.findFirst({
    where: { id, userId },
    select: {
      id: true, status: true,
      trainingSession: {
        select: {
          id: true,
          name: true,
          timezone: true,
          course: {
            select: {
              id: true, title: true,
              modules: {
                where: { isPublished: true },
                orderBy: { position: 'asc' },
                select: {
                  id: true, title: true, description: true, position: true,
                  lessons: {
                    where: { isPublished: true },
                    orderBy: { position: 'asc' },
                    select: {
                      id: true, title: true, description: true, position: true, estimatedMinutes: true,
                      lessonProgress: { where: { enrollmentId: id }, select: { completedAt: true }, take: 1 },
                      classMeetings: {
                        where: { trainingSession: { enrollments: { some: { id } } } },
                        orderBy: { startsAt: 'asc' },
                        select: { id: true, startsAt: true, endsAt: true, status: true, platform: true },
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
  return enrollment;
}

function accessForStatus(status) {
  return {
    canViewOutline: FULL_ACCESS_STATUSES.includes(status) || OUTLINE_ACCESS_STATUSES.includes(status),
    canViewContent: FULL_ACCESS_STATUSES.includes(status),
    blocked: !FULL_ACCESS_STATUSES.includes(status),
  };
}

function progressSummary(modules) {
  const lessons = modules.flatMap((module) => module.lessons);
  const completedLessons = lessons.filter((lesson) => Boolean(lesson.lessonProgress[0]?.completedAt)).length;
  const totalPublishedLessons = lessons.length;
  return {
    totalPublishedLessons,
    completedLessons,
    remainingLessons: totalPublishedLessons - completedLessons,
    progressPercentage: totalPublishedLessons ? Math.round((completedLessons / totalPublishedLessons) * 100) : 0,
    estimatedMinutes: lessons.reduce((sum, lesson) => sum + (lesson.estimatedMinutes || 0), 0),
    nextLesson: lessons.find((lesson) => !lesson.lessonProgress[0]?.completedAt) || null,
  };
}

async function getLearningPath(userId, enrollmentId) {
  const enrollment = await enrollmentForLearning(userId, enrollmentId);
  const access = accessForStatus(enrollment.status);
  if (!access.canViewOutline) {
    throw new LearningAccessError('LEARNING_BLOCKED', 'Cette inscription ne permet pas d’accéder au contenu.', 403);
  }
  const modules = enrollment.trainingSession.course.modules.map((module) => ({
    ...module,
    completedLessons: module.lessons.filter((lesson) => lesson.lessonProgress[0]?.completedAt).length,
  }));
  return { enrollment, course: enrollment.trainingSession.course, modules, access, progress: progressSummary(modules) };
}

async function getLesson(userId, enrollmentId, lessonId) {
  const path = await getLearningPath(userId, enrollmentId);
  if (!path.access.canViewContent) {
    throw new LearningAccessError('CONTENT_BLOCKED', 'Payez la formation pour ouvrir le contenu des leçons.', 403);
  }
  const lessons = path.modules.flatMap((module) => module.lessons);
  const index = lessons.findIndex((lesson) => lesson.id === Number(lessonId));
  if (index < 0) throw new LearningAccessError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  const lesson = await prisma.lesson.findFirst({
    where: {
      id: Number(lessonId), isPublished: true,
      courseModule: { isPublished: true, courseId: path.course.id },
    },
    select: {
      id: true, title: true, description: true, content: true, estimatedMinutes: true,
      resources: { orderBy: { position: 'asc' }, select: { id: true, title: true, type: true, url: true } },
      lessonProgress: { where: { enrollmentId: path.enrollment.id }, select: { completedAt: true }, take: 1 },
    },
  });
  if (!lesson) throw new LearningAccessError('LESSON_NOT_FOUND', 'Leçon introuvable.', 404);
  return { ...path, lesson, previousLesson: lessons[index - 1] || null, nextLesson: lessons[index + 1] || null };
}

async function setCompleted(userId, enrollmentId, lessonId, completed) {
  const data = await getLesson(userId, enrollmentId, lessonId);
  await prisma.lessonProgress.upsert({
    where: { enrollmentId_lessonId: { enrollmentId: data.enrollment.id, lessonId: data.lesson.id } },
    create: { enrollmentId: data.enrollment.id, lessonId: data.lesson.id, completedAt: completed ? new Date() : null },
    update: { completedAt: completed ? new Date() : null },
  });
  return data;
}

module.exports = {
  FULL_ACCESS_STATUSES, OUTLINE_ACCESS_STATUSES, LearningAccessError,
  accessForStatus, progressSummary, getLearningPath, getLesson, setCompleted,
};
