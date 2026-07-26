const prisma = require('../utils/prisma');
async function resolve(type, ref) {
  if (type === 'ALL') return (await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map(x => x.id);
  if (type === 'STUDENTS' || type === 'TEACHERS') return (await prisma.user.findMany({ where: { isActive: true, role: type === 'STUDENTS' ? 'STUDENT' : 'TEACHER' }, select: { id: true } })).map(x => x.id);
  const id = Number(ref);
  if (!Number.isInteger(id) || id <= 0) return [];
  if (type === 'SESSION') {
    const session = await prisma.trainingSession.findUnique({ where: { id }, select: { enrollments: { where: { status: { in: ['TRIAL_ACTIVE','CONFIRMED','PAYMENT_REQUIRED'] } }, select: { userId: true } }, teachers: { select: { teacherId: true } } } });
    return session ? [...new Set([...session.enrollments.map(x => x.userId), ...session.teachers.map(x => x.teacherId)])] : [];
  }
  if (type === 'COURSE') {
    const users = await prisma.enrollment.findMany({ where: { trainingSession: { courseId: id }, status: { in: ['TRIAL_ACTIVE','CONFIRMED','PAYMENT_REQUIRED'] } }, select: { userId: true } });
    return [...new Set(users.map(x => x.userId))];
  }
  return [];
}
module.exports = { resolve };
