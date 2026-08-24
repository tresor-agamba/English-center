const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { TRIAL_LIMIT, OCCUPYING_ENROLLMENT_STATUSES, remainingPlaces, sessionRegistrationState, isSessionOpenForRegistration } = require('./enrollmentPolicy');
const enrollmentReminders = require('./enrollmentReminderService');
const whatsappPreferences = require('./whatsappPreferenceService');
const placement = require('./placementTestService');
const { isPublicCourse } = require('./coursePublicationPolicy');

const OCCUPYING_STATUSES = OCCUPYING_ENROLLMENT_STATUSES;
const MAX_TRANSACTION_ATTEMPTS = 8;

class RegistrationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 20));
}

const messages = {
  SESSION_REQUIRED: 'Veuillez sélectionner une session.',
  SESSION_NOT_FOUND: 'Cette session est introuvable.',
  SESSION_UNAVAILABLE: 'Cette session n’est plus disponible aux inscriptions.',
  REGISTRATION_CLOSED: 'La date limite d’inscription est dépassée.',
  SESSION_FULL: 'Cette session est complète.',
  ACCOUNT_EXISTS: 'Un compte existe déjà avec ce numéro. Connectez-vous pour continuer votre inscription.',
  DUPLICATE_ENROLLMENT: 'Vous êtes déjà inscrit à cette session.',
};

function parseSessionId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RegistrationError('SESSION_REQUIRED', messages.SESSION_REQUIRED);
  }
  return id;
}

function parseCourseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new RegistrationError('COURSE_REQUIRED', 'Veuillez sélectionner une formation.');
  }
  return id;
}

function validateLevel(value) {
  if (!placement.LEVELS.includes(value)) {
    throw new RegistrationError('INVALID_LEVEL', 'Le niveau demandé est invalide.');
  }
  return value;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RegistrationError('INVALID_EMAIL', 'Adresse email invalide.');
  }
  return email;
}

function sessionSelect(now) {
  return {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
    registrationDeadline: true,
    capacity: true,
    weekDays: true,
    startTime: true,
    endTime: true,
    platform: true,
    timezone: true,
    status: true,
    course: {
      select: {
        id: true,
        slug: true,
        title: true,
        shortDescription: true,
        price: true,
        currency: true,
        registrationFee: true,
        pricingMode: true,
        trainingMode: true,
        isPublished: true,
        lmsStatus: true,
        archivedAt: true,
        closedAt: true,
        createdAt: true,
        description: true,
        level: true,
        duration: true,
        durationValue: true,
        durationUnit: true,
        pricingActive: true,
      },
    },
    _count: {
      select: {
        enrollments: { where: { status: { in: OCCUPYING_STATUSES } } },
      },
    },
  };
}

function validateSession(session, now = new Date(), options = {}) {
  const { checkCapacity = true } = options;
  if (!session || !isPublicCourse(session.course)) {
    throw new RegistrationError('SESSION_NOT_FOUND', messages.SESSION_NOT_FOUND, 404);
  }
  const state = sessionRegistrationState(session, now);
  if (state === 'UNAVAILABLE') {
    throw new RegistrationError('SESSION_UNAVAILABLE', messages.SESSION_UNAVAILABLE);
  }
  if (state === 'CLOSED') {
    throw new RegistrationError('REGISTRATION_CLOSED', messages.REGISTRATION_CLOSED);
  }
  const availablePlaces = remainingPlaces(session);
  if (checkCapacity && state === 'FULL') {
    throw new RegistrationError('SESSION_FULL', messages.SESSION_FULL);
  }
  return { ...session, remainingPlaces: availablePlaces };
}

function enrollmentPricingSnapshot(session) {
  if (session.course.pricingMode !== 'ONE_TIME' || session.course.price === null || Number(session.course.price) <= 0) return {};
  return {
    expectedTotalAmount: new Prisma.Decimal(session.course.price),
    expectedCurrency: session.course.currency,
  };
}

async function getSessionSnapshot(rawSessionId, client = prisma) {
  const sessionId = parseSessionId(rawSessionId);
  const now = new Date();
  const session = await client.trainingSession.findUnique({
    where: { id: sessionId },
    select: sessionSelect(now),
  });
  return { session, now };
}

async function getSessionForRegistration(rawSessionId, client = prisma) {
  const { session, now } = await getSessionSnapshot(rawSessionId, client);
  return validateSession(session, now);
}

async function listCoursesForPublicRegistration(client = prisma) {
  const now = new Date();
  const courses = await client.course.findMany({
    where: {
      isPublished: true,
      lmsStatus: 'PUBLISHED', archivedAt: null, closedAt: null,
      trainingSessions: { some: { status: 'OPEN', startDate: { gte: now }, registrationDeadline: { gte: now } } },
    },
    select: {
      id: true, title: true, slug: true, shortDescription: true, description: true, level: true,
      duration: true, durationValue: true, durationUnit: true, price: true, currency: true,
      pricingMode: true, pricingActive: true, isPublished: true, lmsStatus: true,
      archivedAt: true, closedAt: true, createdAt: true,
      trainingSessions: {
        where: { status: 'OPEN', startDate: { gte: now }, registrationDeadline: { gte: now } },
        select: { status: true, startDate: true, registrationDeadline: true, capacity: true,
          _count: { select: { enrollments: { where: { status: { in: OCCUPYING_STATUSES } } } } } },
      },
    },
    orderBy: { title: 'asc' },
  });
  return courses
    .filter((course) => isPublicCourse(course) && course.trainingSessions.some((session) => isSessionOpenForRegistration(session, now)))
    .map(({ id, title, slug }) => ({ id, title, slug }));
}

async function getCourseRegistrationSession(rawCourseId, client = prisma) {
  const courseId = parseCourseId(rawCourseId);
  const now = new Date();
  const course = await client.course.findFirst({
    where: { id: courseId, isPublished: true, lmsStatus: 'PUBLISHED', archivedAt: null, closedAt: null },
    select: {
      trainingSessions: {
        where: { status: 'OPEN', startDate: { gte: now }, registrationDeadline: { gte: now } },
        orderBy: { startDate: 'asc' },
        select: sessionSelect(now),
      },
    },
  });
  if (!course) throw new RegistrationError('COURSE_UNAVAILABLE', 'Cette formation n’est pas disponible aux inscriptions publiques.');
  for (const candidate of course.trainingSessions) {
    try { return validateSession(candidate, now); } catch (error) {
      if (!['SESSION_FULL', 'REGISTRATION_CLOSED'].includes(error.code)) throw error;
    }
  }
  throw new RegistrationError('COURSE_UNAVAILABLE', 'Cette formation n’est pas disponible aux inscriptions publiques.');
}

function findUserEnrollment(client, userId, trainingSessionId) {
  return client.enrollment.findUnique({
    where: { userId_trainingSessionId: { userId, trainingSessionId } },
    select: { id: true, status: true },
  });
}

async function getActiveStudent(userId, client = prisma) {
  const user = await client.user.findFirst({
    where: { id: userId, role: 'STUDENT', isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true, isActive: true },
  });
  if (!user) throw new RegistrationError('STUDENT_UNAVAILABLE', 'Votre compte ne permet pas cette inscription.', 403);
  return user;
}

async function getEnrollmentIntent(userId, rawSessionId) {
  await getActiveStudent(userId);
  const sessionId = parseSessionId(rawSessionId);
  const existingEnrollment = await findUserEnrollment(prisma, userId, sessionId);
  if (existingEnrollment && OCCUPYING_STATUSES.includes(existingEnrollment.status)) {
    return { existingEnrollment, session: null };
  }
  const session = await getSessionForRegistration(sessionId);
  return { existingEnrollment, session };
}

async function runRegistrationTransaction({
  sessionId, courseId, firstName, lastName, phoneNumber, email = null, passwordHash, requestedLevel = null,
}) {
  return prisma.$transaction(
    async (tx) => {
      const session = courseId
        ? await getCourseRegistrationSession(courseId, tx)
        : await getSessionForRegistration(sessionId, tx);
      const level = requestedLevel ? validateLevel(requestedLevel) : null;
      const normalizedEmail = normalizeEmail(email);
      const existingUser = await tx.user.findUnique({
        where: { phoneNumber },
        select: { id: true },
      });
      if (existingUser) {
        const duplicate = await tx.enrollment.findUnique({
          where: {
            userId_trainingSessionId: {
              userId: existingUser.id,
              trainingSessionId: session.id,
            },
          },
          select: { id: true },
        });
        throw new RegistrationError(
          duplicate ? 'DUPLICATE_ENROLLMENT' : 'ACCOUNT_EXISTS',
          duplicate ? messages.DUPLICATE_ENROLLMENT : messages.ACCOUNT_EXISTS
        );
      }

      if (normalizedEmail && await tx.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) {
        throw new RegistrationError('EMAIL_EXISTS', 'Cette adresse email est déjà utilisée.');
      }

      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          phoneNumber,
          email: normalizedEmail,
          passwordHash,
          role: 'STUDENT',
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          email: true,
          role: true,
          isActive: true,
        },
      });

      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          trainingSessionId: session.id,
          status: level && level !== 'LEVEL_1' ? 'PLACEMENT_TEST_REQUIRED' : 'TRIAL_ACTIVE',
          requestedLevel: level,
          recommendedLevel: level === 'LEVEL_1' ? 'LEVEL_1' : null,
          approvedLevel: level === 'LEVEL_1' ? 'LEVEL_1' : null,
          placementTestRequired: Boolean(level && level !== 'LEVEL_1'),
          ...enrollmentPricingSnapshot(session),
        },
        select: {
          id: true, status: true, requestedLevel: true, recommendedLevel: true,
          approvedLevel: true, placementTestRequired: true,
        },
      });

      return { user, enrollment };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function createRegistration(data) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      const result = await runRegistrationTransaction(data);
      await enrollmentReminders.synchronizeEnrollmentReminders(result.enrollment.id).catch((error) => console.error('Synchronisation rappels inscription:', error.message));
      if (data.whatsappConsent) await whatsappPreferences.recordWhatsAppOptIn(result.user.id, data.phoneNumber, 'REGISTRATION_FORM').catch((error) => console.error('Consentement WhatsApp:', error.message));
      return result;
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      if (error?.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(' ') : String(error.meta?.target || '');
        throw new RegistrationError(
          target.includes('email') ? 'EMAIL_EXISTS' : 'ACCOUNT_EXISTS',
          target.includes('email') ? 'Cette adresse email est déjà utilisée.' : messages.ACCOUNT_EXISTS
        );
      }
      if (error?.code === 'P2034' && attempt < MAX_TRANSACTION_ATTEMPTS) {
        await retryDelay(attempt);
        continue;
      }
      throw error;
    }
  }
  throw new RegistrationError('SESSION_UNAVAILABLE', messages.SESSION_UNAVAILABLE);
}

async function runExistingStudentTransaction({ userId, sessionId }) {
  return prisma.$transaction(
    async (tx) => {
      const user = await getActiveStudent(userId, tx);

      const parsedSessionId = parseSessionId(sessionId);
      const { session, now } = await getSessionSnapshot(parsedSessionId, tx);
      const existingEnrollment = await findUserEnrollment(tx, user.id, parsedSessionId);

      if (existingEnrollment && OCCUPYING_STATUSES.includes(existingEnrollment.status)) {
        validateSession(session, now, { checkCapacity: false });
        return { enrollment: existingEnrollment, reused: true, reactivated: false };
      }

      const availableSession = validateSession(session, now);
      if (existingEnrollment) {
        const presentCount = await tx.attendance.count({
          where: { enrollmentId: existingEnrollment.id, status: 'PRESENT' },
        });
        const reactivatedStatus =
          existingEnrollment.status === 'PAYMENT_FAILED' && presentCount >= TRIAL_LIMIT
            ? 'PAYMENT_REQUIRED'
            : 'TRIAL_ACTIVE';
        const enrollment = await tx.enrollment.update({
          where: { id: existingEnrollment.id },
          data: { status: reactivatedStatus, enrolledAt: new Date() },
          select: { id: true, status: true },
        });
        return { enrollment, reused: true, reactivated: true };
      }

      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          trainingSessionId: availableSession.id,
          status: 'TRIAL_ACTIVE',
          ...enrollmentPricingSnapshot(availableSession),
        },
        select: { id: true, status: true },
      });
      return { enrollment, reused: false, reactivated: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function enrollExistingStudent(data) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      const result = await runExistingStudentTransaction(data);
      await enrollmentReminders.synchronizeEnrollmentReminders(result.enrollment.id).catch((error) => console.error('Synchronisation rappels inscription:', error.message));
      return result;
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      if (error?.code === 'P2002') {
          const existing = await findUserEnrollment(prisma, data.userId, parseSessionId(data.sessionId));
          if (existing) {
            await enrollmentReminders.synchronizeEnrollmentReminders(existing.id).catch((syncError) => console.error('Synchronisation rappels inscription:', syncError.message));
            return { enrollment: existing, reused: true, reactivated: false };
          }
      }
      if (error?.code === 'P2034' && attempt < MAX_TRANSACTION_ATTEMPTS) {
        await retryDelay(attempt);
        continue;
      }
      throw error;
    }
  }
  throw new RegistrationError('SESSION_UNAVAILABLE', messages.SESSION_UNAVAILABLE);
}

function findEnrollmentForViewer(enrollmentId) {
  return prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      enrolledAt: true,
      requestedLevel: true,
      recommendedLevel: true,
      approvedLevel: true,
      placementTestRequired: true,
      placementTestScore: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      trainingSession: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          startTime: true,
          endTime: true,
          course: {
            select: {
              title: true,
              slug: true,
              price: true,
              currency: true,
              trainingMode: true,
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          reference: true,
          amount: true,
          currency: true,
          status: true,
          failureReason: true,
          paidAt: true,
          expiresAt: true,
          createdAt: true,
        },
      },
    },
  });
}

module.exports = {
  OCCUPYING_STATUSES,
  RegistrationError,
  messages,
  parseSessionId,
  parseCourseId,
  validateLevel,
  normalizeEmail,
  validateSession,
  getSessionForRegistration,
  listCoursesForPublicRegistration,
  getCourseRegistrationSession,
  getEnrollmentIntent,
  createRegistration,
  enrollExistingStudent,
  findEnrollmentForViewer,
};
