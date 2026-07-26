const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const notificationEvents = require('./notificationEventService');

const ELIGIBLE_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];

class AssignmentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AssignmentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseId(value, label = 'élément') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AssignmentError('INVALID_ID', `Identifiant de ${label} invalide.`);
  return id;
}

function requiredText(value, label, max) {
  const text = value?.trim() || '';
  if (!text) throw new AssignmentError('REQUIRED_FIELD', `${label} est obligatoire.`);
  if (text.length > max) throw new AssignmentError('FIELD_TOO_LONG', `${label} est trop long.`);
  return text;
}

function parseDecimal(value, label, { positive = false } = {}) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(raw)) throw new AssignmentError('INVALID_DECIMAL', `${label} est invalide.`);
  const decimal = new Prisma.Decimal(raw);
  if ((positive && decimal.lte(0)) || decimal.gt(new Prisma.Decimal('9999.99'))) {
    throw new AssignmentError('INVALID_DECIMAL', `${label} est invalide.`);
  }
  return decimal;
}

function parseDueAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AssignmentError('INVALID_DUE_DATE', 'La date limite est invalide.');
  return date;
}

async function resolveLinks(courseId, moduleValue, lessonValue, client = prisma) {
  const course = await client.course.findUnique({ where: { id: parseId(courseId, 'formation') }, select: { id: true } });
  if (!course) throw new AssignmentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  let courseModuleId = moduleValue ? parseId(moduleValue, 'module') : null;
  let lessonId = lessonValue ? parseId(lessonValue, 'leçon') : null;
  let lesson = null;
  if (lessonId) {
    lesson = await client.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true, courseModuleId: true, courseModule: { select: { courseId: true } } },
    });
    if (!lesson || lesson.courseModule.courseId !== course.id) {
      throw new AssignmentError('LESSON_COURSE_MISMATCH', 'La leçon n’appartient pas à cette formation.');
    }
    if (courseModuleId && lesson.courseModuleId !== courseModuleId) {
      throw new AssignmentError('LESSON_MODULE_MISMATCH', 'La leçon n’appartient pas au module sélectionné.');
    }
    courseModuleId = lesson.courseModuleId;
  }
  if (courseModuleId) {
    const module = await client.courseModule.findUnique({ where: { id: courseModuleId }, select: { courseId: true } });
    if (!module || module.courseId !== course.id) {
      throw new AssignmentError('MODULE_COURSE_MISMATCH', 'Le module n’appartient pas à cette formation.');
    }
  }
  return { courseId: course.id, courseModuleId, lessonId };
}

async function formData(courseId, body) {
  const trainingSessionId = body.trainingSessionId ? parseId(body.trainingSessionId, 'session') : null;
  if (trainingSessionId) {
    const session = await prisma.trainingSession.findUnique({ where: { id: trainingSessionId }, select: { courseId: true } });
    if (!session || session.courseId !== parseId(courseId, 'formation')) {
      throw new AssignmentError('SESSION_COURSE_MISMATCH', 'La session n’appartient pas à cette formation.');
    }
  }
  return {
    ...(await resolveLinks(courseId, body.courseModuleId, body.lessonId)),
    title: requiredText(body.title, 'Le titre', 200),
    instructions: requiredText(body.instructions, 'Les consignes', 20000),
    maxScore: parseDecimal(body.maxScore, 'La note maximale', { positive: true }),
    dueAt: parseDueAt(body.dueAt),
    isPublished: body.isPublished === 'on' || body.isPublished === 'true',
    allowLateSubmission: body.allowLateSubmission === 'on' || body.allowLateSubmission === 'true',
    trainingSessionId,
  };
}

function assignmentInclude() {
  return {
    course: { select: { id: true, title: true } },
    courseModule: { select: { id: true, title: true } },
    lesson: { select: { id: true, title: true } },
    trainingSession: { select: { id: true, name: true } },
    submissions: {
      select: { id: true, status: true, score: true, feedbackPublishedAt: true },
    },
  };
}

async function courseAssignments(courseId) {
  const course = await prisma.course.findUnique({
    where: { id: parseId(courseId, 'formation') },
    select: {
      id: true, title: true,
      modules: { orderBy: { position: 'asc' }, select: { id: true, title: true, lessons: { orderBy: { position: 'asc' }, select: { id: true, title: true } } } },
      assignments: { orderBy: { createdAt: 'desc' }, include: assignmentInclude() },
    },
  });
  if (!course) throw new AssignmentError('COURSE_NOT_FOUND', 'Formation introuvable.', 404);
  return course;
}

async function getAssignment(value) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: parseId(value, 'devoir') },
    include: assignmentInclude(),
  });
  if (!assignment) throw new AssignmentError('ASSIGNMENT_NOT_FOUND', 'Devoir introuvable.', 404);
  return assignment;
}

async function createAssignment(courseId, body) {
  const assignment = await prisma.assignment.create({ data: await formData(courseId, body) });
  if (assignment.isPublished) await notificationEvents.assignmentPublished(assignment).catch((error) => console.error('Notifications devoir:', error.message));
  return assignment;
}

async function updateAssignment(assignmentId, body) {
  const assignment = await getAssignment(assignmentId);
  return prisma.assignment.update({ where: { id: assignment.id }, data: await formData(assignment.courseId, body) });
}

async function togglePublished(assignmentId) {
  const assignment = await getAssignment(assignmentId);
  const updated = await prisma.assignment.update({ where: { id: assignment.id }, data: { isPublished: !assignment.isPublished } });
  if (updated.isPublished) await notificationEvents.assignmentPublished(updated).catch((error) => console.error('Notifications devoir:', error.message));
  return updated;
}

async function deleteAssignment(assignmentId) {
  const assignment = await getAssignment(assignmentId);
  if (assignment.submissions.length) {
    await prisma.assignment.update({ where: { id: assignment.id }, data: { isPublished: false } });
    return { hidden: true, courseId: assignment.courseId };
  }
  await prisma.assignment.delete({ where: { id: assignment.id } });
  return { deleted: true, courseId: assignment.courseId };
}

async function submissionRows(assignmentId) {
  const assignment = await getAssignment(assignmentId);
  const enrollments = await prisma.enrollment.findMany({
    where: {
      trainingSession: { courseId: assignment.courseId },
      ...(assignment.trainingSessionId ? { trainingSessionId: assignment.trainingSessionId } : {}),
      status: { in: ELIGIBLE_STATUSES },
    },
    orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
    select: {
      id: true, status: true,
      user: { select: { firstName: true, lastName: true, phoneNumber: true } },
      assignmentSubmissions: {
        where: { assignmentId: assignment.id },
        select: {
          id: true, status: true, submittedAt: true, score: true, feedbackPublishedAt: true,
        },
        take: 1,
      },
    },
  });
  return {
    assignment,
    rows: enrollments.map((enrollment) => ({ ...enrollment, submission: enrollment.assignmentSubmissions[0] || null })),
  };
}

function calculateStatistics(rows, maxScore) {
  const submissions = rows.map((row) => row.submission).filter(Boolean);
  const graded = submissions.filter((submission) => submission.score !== null);
  const totalScore = graded.reduce((sum, submission) => sum.plus(submission.score), new Prisma.Decimal(0));
  const averageScore = graded.length ? totalScore.div(graded.length) : new Prisma.Decimal(0);
  const max = new Prisma.Decimal(maxScore);
  return {
    eligibleStudents: rows.length,
    submittedCount: submissions.length,
    lateCount: submissions.filter((item) => item.status === 'LATE').length,
    gradedCount: submissions.filter((item) => ['GRADED', 'RETURNED'].includes(item.status)).length,
    returnedCount: submissions.filter((item) => item.status === 'RETURNED').length,
    missingCount: rows.length - submissions.length,
    submissionRate: rows.length ? (submissions.length * 100) / rows.length : 0,
    averageScore,
    averagePercentage: graded.length && !max.isZero() ? averageScore.div(max).mul(100) : new Prisma.Decimal(0),
  };
}

async function getSubmission(assignmentId, submissionId) {
  const assignment = await getAssignment(assignmentId);
  const submission = await prisma.assignmentSubmission.findFirst({
    where: { id: parseId(submissionId, 'soumission'), assignmentId: assignment.id },
    include: {
      enrollment: { select: { status: true, user: { select: { firstName: true, lastName: true, phoneNumber: true } } } },
    },
  });
  if (!submission) throw new AssignmentError('SUBMISSION_NOT_FOUND', 'Soumission introuvable.', 404);
  return { assignment, submission };
}

async function gradeSubmission(assignmentId, submissionId, body) {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.assignment.findUnique({
      where: { id: parseId(assignmentId, 'devoir') },
      select: { id: true, maxScore: true },
    });
    if (!assignment) throw new AssignmentError('ASSIGNMENT_NOT_FOUND', 'Devoir introuvable.', 404);
    const submission = await tx.assignmentSubmission.findFirst({
      where: { id: parseId(submissionId, 'soumission'), assignmentId: assignment.id },
      select: { id: true },
    });
    if (!submission) throw new AssignmentError('SUBMISSION_NOT_FOUND', 'Soumission introuvable.', 404);
    const score = parseDecimal(body.score, 'La note');
    if (score.lt(0) || score.gt(assignment.maxScore)) {
      throw new AssignmentError('INVALID_SCORE', 'La note doit être comprise entre zéro et la note maximale.');
    }
    const feedback = body.feedback?.trim() || null;
    if (feedback && feedback.length > 20000) throw new AssignmentError('FEEDBACK_TOO_LONG', 'Le commentaire est trop long.');
    return tx.assignmentSubmission.update({
      where: { id: submission.id },
      data: { score, feedback, gradedAt: new Date(), feedbackPublishedAt: null, status: 'GRADED' },
    });
  });
}

async function setFeedbackPublished(assignmentId, submissionId, published) {
  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.assignmentSubmission.findFirst({
      where: { id: parseId(submissionId, 'soumission'), assignmentId: parseId(assignmentId, 'devoir') },
      select: { id: true, score: true, gradedAt: true },
    });
    if (!submission) throw new AssignmentError('SUBMISSION_NOT_FOUND', 'Soumission introuvable.', 404);
    if (published && (submission.score === null || !submission.gradedAt)) {
      throw new AssignmentError('NOT_GRADED', 'La soumission doit être corrigée avant publication.');
    }
    return tx.assignmentSubmission.update({
      where: { id: submission.id },
      data: { feedbackPublishedAt: published ? new Date() : null, status: published ? 'RETURNED' : 'GRADED' },
    });
  });
  if (published) await notificationEvents.feedbackPublished(parseId(assignmentId, 'devoir'), parseId(submissionId, 'soumission')).catch((error) => console.error('Notification correction:', error.message));
  return result;
}

module.exports = {
  ELIGIBLE_STATUSES, AssignmentError, parseId, parseDecimal, parseDueAt, resolveLinks,
  courseAssignments, getAssignment, createAssignment, updateAssignment, togglePublished, deleteAssignment,
  submissionRows, calculateStatistics, getSubmission, gradeSubmission, setFeedbackPublished,
};
