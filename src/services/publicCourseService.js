const prisma = require('../utils/prisma');

const PUBLIC_SESSION_STATUSES = ['OPEN', 'FULL'];
const OCCUPYING_ENROLLMENT_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'];

function futureSessionWhere(now) {
  return {
    startDate: { gte: now },
    status: { in: PUBLIC_SESSION_STATUSES },
  };
}

async function listPublished() {
  const now = new Date();
  const courses = await prisma.course.findMany({
    where: { isPublished: true },
    orderBy: [{ createdAt: 'desc' }, { title: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      shortDescription: true,
      description: true,
      level: true,
      duration: true,
      price: true,
      currency: true,
      trainingSessions: {
        where: futureSessionWhere(now),
        select: {
          capacity: true,
          status: true,
          registrationDeadline: true,
          _count: {
            select: {
              enrollments: { where: { status: { in: OCCUPYING_ENROLLMENT_STATUSES } } },
            },
          },
        },
      },
    },
  });

  return courses.map(({ trainingSessions, ...course }) => ({
    ...course,
    upcomingSessionCount: trainingSessions.filter(
      (session) =>
        session.status === 'OPEN' &&
        session.registrationDeadline >= now &&
        session._count.enrollments < session.capacity
    ).length,
  }));
}

async function findPublishedBySlug(slug) {
  const now = new Date();
  const course = await prisma.course.findFirst({
    where: { slug, isPublished: true },
    select: {
      id: true,
      slug: true,
      title: true,
      shortDescription: true,
      description: true,
      level: true,
      duration: true,
      objectives: true,
      targetAudience: true,
      prerequisites: true,
      price: true,
      currency: true,
      trainingMode: true,
      trainingSessions: {
        where: futureSessionWhere(now),
        orderBy: { startDate: 'asc' },
        select: {
          id: true,
          name: true,
          startDate: true,
          endDate: true,
          registrationDeadline: true,
          capacity: true,
          status: true,
          _count: {
            select: {
              enrollments: { where: { status: { in: OCCUPYING_ENROLLMENT_STATUSES } } },
            },
          },
        },
      },
    },
  });

  if (!course) return null;

  return {
    ...course,
    trainingSessions: course.trainingSessions.map((session) => {
      const remainingPlaces = Math.max(0, session.capacity - session._count.enrollments);
      const registrationOpen =
        session.status === 'OPEN' &&
        session.registrationDeadline >= now &&
        remainingPlaces > 0;
      const { _count, ...publicSession } = session;
      return { ...publicSession, remainingPlaces, registrationOpen };
    }),
  };
}

module.exports = { listPublished, findPublishedBySlug };
