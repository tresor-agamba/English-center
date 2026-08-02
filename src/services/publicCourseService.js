const prisma = require('../utils/prisma');
const { OCCUPYING_ENROLLMENT_STATUSES } = require('./enrollmentPolicy');
const { isPublicCourse } = require('./coursePublicationPolicy');

const PUBLIC_SESSION_STATUSES = ['OPEN'];

function futureSessionWhere(now) {
  return {
    startDate: { gte: now },
    status: { in: PUBLIC_SESSION_STATUSES },
  };
}

async function listPublished() {
  const now = new Date();
  const courses = await prisma.course.findMany({
    where: { isPublished: true, lmsStatus: 'PUBLISHED', archivedAt: null, closedAt: null },
    orderBy: [{ createdAt: 'desc' }, { title: 'asc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      shortDescription: true,
      description: true,
      courseType: true,
      level: true,
      duration: true,
      durationValue: true,
      durationUnit: true,
      price: true,
      currency: true,
      pricingMode: true,
      pricingActive: true,
      isPublished: true,
      lmsStatus: true,
      archivedAt: true,
      closedAt: true,
      createdAt: true,
      trainingSessions: {
        where: futureSessionWhere(now),
        select: {
          id: true,
          startDate: true,
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

  return courses.filter(isPublicCourse).map(({ trainingSessions, ...course }) => {
    const availableSessions = trainingSessions.filter(
      (session) =>
        session.status === 'OPEN' &&
        session.registrationDeadline >= now &&
        session._count.enrollments < session.capacity
    ).sort((left, right) => left.startDate - right.startDate || left.id - right.id);
    return {
      ...course,
      upcomingSessionCount: availableSessions.length,
      nextSessionStart: availableSessions[0]?.startDate || null,
    };
  });
}

async function listUpcomingSessions(limit = 3) {
  const now = new Date();
  const sessions = await prisma.trainingSession.findMany({
    where: {
      ...futureSessionWhere(now),
      status: 'OPEN',
      registrationDeadline: { gte: now },
      course: { isPublished: true, lmsStatus: 'PUBLISHED', archivedAt: null, closedAt: null },
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    take: Math.max(1, Math.min(Number(limit) || 3, 6)),
    select: {
      id: true,
      name: true,
      startDate: true,
      weekDays: true,
      startTime: true,
      endTime: true,
      timezone: true,
      platform: true,
      capacity: true,
      courseId: true,
      course: { select: { id: true, title: true, level: true, slug: true, trainingMode: true, shortDescription: true, description: true, duration: true, durationValue: true, durationUnit: true, price: true, currency: true, pricingMode: true, pricingActive: true, isPublished: true, lmsStatus: true, archivedAt: true, closedAt: true, createdAt: true } },
      _count: {
        select: {
          enrollments: { where: { status: { in: OCCUPYING_ENROLLMENT_STATUSES } } },
        },
      },
    },
  });
  return sessions
    .map(({ _count, ...session }) => ({
      ...session,
      remainingPlaces: Math.max(0, session.capacity - _count.enrollments),
    }))
    .filter((session) => session.remainingPlaces > 0 && isPublicCourse(session.course));
}

async function findPublishedBySlug(slug) {
  const now = new Date();
  const course = await prisma.course.findFirst({
    where: { slug, isPublished: true, lmsStatus: 'PUBLISHED', archivedAt: null, closedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      shortDescription: true,
      description: true,
      courseType: true,
      level: true,
      duration: true,
      durationValue: true,
      durationUnit: true,
      objectives: true,
      targetAudience: true,
      prerequisites: true,
      price: true,
      currency: true,
      trainingMode: true,
      pricingMode: true,
      pricingActive: true,
      isPublished: true,
      lmsStatus: true,
      archivedAt: true,
      closedAt: true,
      createdAt: true,
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
          weekDays: true,
          startTime: true,
          endTime: true,
          timezone: true,
          platform: true,
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

  if (!course || !isPublicCourse(course)) return null;

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

module.exports = { listPublished, listUpcomingSessions, findPublishedBySlug };
