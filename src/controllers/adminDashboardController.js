const prisma = require('../utils/prisma');

async function index(req, res) {
  const today = new Date();

  const [
    studentCount,
    courseCount,
    trainingSessionCount,
    enrollmentCount,
    upcomingSessions,
    recentStudents,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'STUDENT' } }),
    prisma.course.count(),
    prisma.trainingSession.count(),
    prisma.enrollment.count(),
    prisma.trainingSession.findMany({
      where: { startDate: { gte: today } },
      orderBy: { startDate: 'asc' },
      take: 5,
      include: { course: true },
    }),
    prisma.user.findMany({
      where: { role: 'STUDENT' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        createdAt: true,
      },
    }),
  ]);

  return res.render('admin/dashboard', {
    title: 'Tableau de bord',
    stats: {
      students: studentCount,
      courses: courseCount,
      sessions: trainingSessionCount,
      enrollments: enrollmentCount,
    },
    upcomingSessions,
    recentStudents,
  });
}

module.exports = { index };
