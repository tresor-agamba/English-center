const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const { TRIAL_LIMIT, OCCUPYING_ENROLLMENT_STATUSES } = require('./enrollmentPolicy');

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

function sessionSelect(now) {
  return {
    id: true,
    name: true,
    startDate: true,
    endDate: true,
      registrationDeadline: true,
      capacity: true,
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
        trainingMode: true,
        isPublished: true,
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
  if (!session || !session.course.isPublished) {
    throw new RegistrationError('SESSION_NOT_FOUND', messages.SESSION_NOT_FOUND, 404);
  }
  if (session.startDate < now || !['OPEN'].includes(session.status)) {
    throw new RegistrationError('SESSION_UNAVAILABLE', messages.SESSION_UNAVAILABLE);
  }
  if (session.registrationDeadline < now) {
    throw new RegistrationError('REGISTRATION_CLOSED', messages.REGISTRATION_CLOSED);
  }
  const remainingPlaces = Math.max(0, session.capacity - session._count.enrollments);
  if (checkCapacity && remainingPlaces < 1) {
    throw new RegistrationError('SESSION_FULL', messages.SESSION_FULL);
  }
  return { ...session, remainingPlaces };
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

async function runRegistrationTransaction({ sessionId, firstName, lastName, phoneNumber, passwordHash }) {
  return prisma.$transaction(
    async (tx) => {
      const session = await getSessionForRegistration(sessionId, tx);
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

      const user = await tx.user.create({
        data: {
          firstName,
          lastName,
          phoneNumber,
          passwordHash,
          role: 'STUDENT',
          isActive: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          role: true,
          isActive: true,
        },
      });

      const enrollment = await tx.enrollment.create({
        data: {
          userId: user.id,
          trainingSessionId: session.id,
          status: 'TRIAL_ACTIVE',
        },
        select: { id: true, status: true },
      });

      return { user, enrollment };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function createRegistration(data) {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await runRegistrationTransaction(data);
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      if (error?.code === 'P2002') {
          throw new RegistrationError('ACCOUNT_EXISTS', messages.ACCOUNT_EXISTS);
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
      return await runExistingStudentTransaction(data);
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      if (error?.code === 'P2002') {
          const existing = await findUserEnrollment(prisma, data.userId, parseSessionId(data.sessionId));
          if (existing) return { enrollment: existing, reused: true, reactivated: false };
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
      user: { select: { id: true, firstName: true, lastName: true } },
      trainingSession: {
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
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
  validateSession,
  getSessionForRegistration,
  getEnrollmentIntent,
  createRegistration,
  enrollExistingStudent,
  findEnrollmentForViewer,
};
