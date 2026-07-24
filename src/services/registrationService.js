const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');

const OCCUPYING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'];
const MAX_TRANSACTION_ATTEMPTS = 3;

class RegistrationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.statusCode = statusCode;
  }
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
    status: true,
    course: {
      select: {
        id: true,
        slug: true,
        title: true,
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

function validateSession(session, now = new Date()) {
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
  if (remainingPlaces < 1) {
    throw new RegistrationError('SESSION_FULL', messages.SESSION_FULL);
  }
  return { ...session, remainingPlaces };
}

async function getSessionForRegistration(rawSessionId, client = prisma) {
  const sessionId = parseSessionId(rawSessionId);
  const now = new Date();
  const session = await client.trainingSession.findUnique({
    where: { id: sessionId },
    select: sessionSelect(now),
  });
  return validateSession(session, now);
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
          status: 'PENDING_PAYMENT',
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
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new RegistrationError('ACCOUNT_EXISTS', messages.ACCOUNT_EXISTS);
        }
        if (error.code === 'P2034' && attempt < MAX_TRANSACTION_ATTEMPTS) continue;
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
  createRegistration,
  findEnrollmentForViewer,
};
