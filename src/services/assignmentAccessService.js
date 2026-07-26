const prisma = require('../utils/prisma');
const assignmentService = require('./assignmentService');

const ALLOWED_STATUSES = ['TRIAL_ACTIVE', 'CONFIRMED'];

async function enrollment(value, userId) {
  const item = await prisma.enrollment.findFirst({
    where: { id: assignmentService.parseId(value, 'inscription'), userId },
    select: {
      id: true, status: true,
      trainingSession: { select: { course: { select: { id: true, title: true } } } },
    },
  });
  if (!item) throw new assignmentService.AssignmentError('ENROLLMENT_NOT_FOUND', 'Inscription introuvable.', 404);
  return item;
}

function studentSubmissionView(submission) {
  if (!submission) return null;
  const feedbackPublished = Boolean(submission.feedbackPublishedAt);
  return {
    id: submission.id,
    answerText: submission.answerText,
    answerUrl: submission.answerUrl,
    status: submission.status,
    submittedAt: submission.submittedAt,
    feedbackPublishedAt: submission.feedbackPublishedAt,
    score: feedbackPublished ? submission.score : null,
    feedback: feedbackPublished ? submission.feedback : null,
  };
}

async function listForEnrollment(userId, enrollmentId, { allowOutline = true } = {}) {
  const item = await enrollment(enrollmentId, userId);
  const fullAccess = ALLOWED_STATUSES.includes(item.status);
  const outlineAccess = item.status === 'PAYMENT_REQUIRED';
  if (!fullAccess && (!allowOutline || !outlineAccess)) {
    throw new assignmentService.AssignmentError('ASSIGNMENT_ACCESS_BLOCKED', 'Accès aux devoirs bloqué.', 403);
  }
  const assignments = await prisma.assignment.findMany({
    where: { courseId: item.trainingSession.course.id, isPublished: true },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, title: true, maxScore: true, dueAt: true, allowLateSubmission: true,
      courseModule: { select: { title: true } }, lesson: { select: { title: true } },
      submissions: {
        where: { enrollmentId: item.id },
        select: {
          id: true, answerText: true, answerUrl: true, status: true, submittedAt: true,
          score: true, feedback: true, feedbackPublishedAt: true,
        },
        take: 1,
      },
    },
  });
  return {
    enrollment: item,
    course: item.trainingSession.course,
    fullAccess,
    assignments: assignments.map((assignment) => ({
      ...assignment,
      submission: studentSubmissionView(assignment.submissions[0]),
      submissions: undefined,
    })),
  };
}

async function getForStudent(userId, enrollmentId, assignmentId) {
  const item = await enrollment(enrollmentId, userId);
  if (!ALLOWED_STATUSES.includes(item.status)) {
    throw new assignmentService.AssignmentError('ASSIGNMENT_ACCESS_BLOCKED', 'Accès aux devoirs bloqué.', 403);
  }
  const assignment = await prisma.assignment.findFirst({
    where: {
      id: assignmentService.parseId(assignmentId, 'devoir'),
      courseId: item.trainingSession.course.id,
      isPublished: true,
    },
    select: {
      id: true, title: true, instructions: true, maxScore: true, dueAt: true, allowLateSubmission: true,
      courseModule: { select: { title: true } }, lesson: { select: { title: true } },
      submissions: {
        where: { enrollmentId: item.id },
        select: {
          id: true, answerText: true, answerUrl: true, status: true, submittedAt: true,
          score: true, feedback: true, gradedAt: true, feedbackPublishedAt: true,
        },
        take: 1,
      },
    },
  });
  if (!assignment) throw new assignmentService.AssignmentError('ASSIGNMENT_NOT_FOUND', 'Devoir introuvable.', 404);
  const submission = studentSubmissionView(assignment.submissions[0]);
  const now = new Date();
  const pastDue = Boolean(assignment.dueAt && now > assignment.dueAt);
  const canSubmit = (!pastDue || assignment.allowLateSubmission) && !submission?.feedbackPublishedAt;
  return { enrollment: item, course: item.trainingSession.course, assignment: { ...assignment, submissions: undefined }, submission, pastDue, canSubmit };
}

function answerData(body) {
  const answerText = body.answerText?.trim() || null;
  if (answerText && answerText.length > 30000) throw new assignmentService.AssignmentError('ANSWER_TOO_LONG', 'La réponse est trop longue.');
  let answerUrl = body.answerUrl?.trim() || null;
  if (answerUrl) {
    if (answerUrl.length > 2000) throw new assignmentService.AssignmentError('URL_TOO_LONG', 'L’URL est trop longue.');
    try {
      const parsed = new URL(answerUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      answerUrl = parsed.toString();
    } catch {
      throw new assignmentService.AssignmentError('INVALID_URL', 'L’URL doit utiliser HTTP ou HTTPS.');
    }
  }
  if (!answerText && !answerUrl) throw new assignmentService.AssignmentError('EMPTY_SUBMISSION', 'Ajoutez une réponse ou une URL.');
  return { answerText, answerUrl };
}

async function submit(userId, enrollmentId, assignmentId, body) {
  const access = await getForStudent(userId, enrollmentId, assignmentId);
  if (!access.canSubmit) throw new assignmentService.AssignmentError('SUBMISSION_LOCKED', 'Cette soumission ne peut plus être modifiée.', 403);
  const answers = answerData(body);
  const now = new Date();
  const late = Boolean(access.assignment.dueAt && now > access.assignment.dueAt);
  if (late && !access.assignment.allowLateSubmission) {
    throw new assignmentService.AssignmentError('DEADLINE_PASSED', 'La date limite est dépassée.', 403);
  }
  return prisma.$transaction((tx) => tx.assignmentSubmission.upsert({
    where: { assignmentId_enrollmentId: { assignmentId: access.assignment.id, enrollmentId: access.enrollment.id } },
    create: {
      assignmentId: access.assignment.id, enrollmentId: access.enrollment.id,
      ...answers, status: late ? 'LATE' : 'SUBMITTED', submittedAt: now,
    },
    update: {
      ...answers, status: late ? 'LATE' : 'SUBMITTED', submittedAt: now,
      score: null, feedback: null, gradedAt: null, feedbackPublishedAt: null,
    },
  }));
}

async function listAll(userId) {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    select: { id: true },
  });
  const paths = await Promise.all(enrollments.map((item) => listForEnrollment(userId, item.id).catch(() => null)));
  return paths.filter(Boolean).flatMap((path) =>
    path.assignments.map((assignment) => ({ ...assignment, enrollmentId: path.enrollment.id, course: path.course, fullAccess: path.fullAccess }))
  );
}

function overview(assignments) {
  const total = assignments.length;
  const submitted = assignments.filter((item) => item.submission).length;
  return {
    total,
    todo: assignments.filter((item) => !item.submission && item.fullAccess).length,
    submitted,
    late: assignments.filter((item) => item.submission?.status === 'LATE').length,
    graded: assignments.filter((item) => item.submission?.feedbackPublishedAt).length,
    completionPercentage: total ? Math.round((submitted / total) * 100) : 0,
  };
}

module.exports = {
  ALLOWED_STATUSES, enrollment, studentSubmissionView, listForEnrollment, getForStudent,
  answerData, submit, listAll, overview,
};
