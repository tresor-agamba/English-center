const prisma = require('../utils/prisma');

const PAGE_SIZE = 10;
const publicStudentSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  email: true,
  whatsappNumber: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

function buildSearchWhere(search, filters = {}) {
  const value = search.trim();
  const where = { role: 'STUDENT' };

  const phonePart = value.replace(/\D/g, '');
  const or = value ? [
    { firstName: { contains: value, mode: 'insensitive' } },
    { lastName: { contains: value, mode: 'insensitive' } },
  ] : [];
  if (value && phonePart) or.push({ phoneNumber: { contains: phonePart } });
  if (value) or.push({ email: { contains: value, mode: 'insensitive' } }, { whatsappNumber: { contains: value } });
  if (or.length) where.OR = or;
  const enrollment = {};
  if (filters.courseId) enrollment.trainingSession = { courseId: filters.courseId };
  if (filters.sessionId) enrollment.trainingSessionId = filters.sessionId;
  if (filters.groupId) enrollment.registrationGroupId = filters.groupId;
  if (filters.level) enrollment.approvedLevel = filters.level;
  if (filters.status) enrollment.status = filters.status;
  if (Object.keys(enrollment).length) where.enrollments = { some: enrollment };
  return where;
}

async function filterOptions() {
  const courses = await prisma.course.findMany({ select: { id: true, title: true, trainingSessions: { select: { id: true, name: true, registrationGroups: { select: { id: true, name: true } } } } }, orderBy: { title: 'asc' } });
  return { courses };
}

async function list({ search = '', page = 1, filters = {} }) {
  const where = buildSearchWhere(search, filters);
  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { ...publicStudentSelect, enrollments: { where: Object.keys(filters).length ? {
        ...(filters.courseId ? { trainingSession: { courseId: filters.courseId } } : {}), ...(filters.sessionId ? { trainingSessionId: filters.sessionId } : {}), ...(filters.groupId ? { registrationGroupId: filters.groupId } : {}), ...(filters.level ? { approvedLevel: filters.level } : {}), ...(filters.status ? { status: filters.status } : {}),
      } : {}, take: 3, orderBy: { enrolledAt: 'desc' }, select: { id: true, status: true, approvedLevel: true, trainingSession: { select: { name: true, course: { select: { title: true } } } }, registrationGroup: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  return { students, total, pageSize: PAGE_SIZE, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

function findById(id) {
  return prisma.user.findFirst({
    where: { id, role: 'STUDENT' },
    select: {
      ...publicStudentSelect,
      enrollments: {
        orderBy: { enrolledAt: 'desc' },
        select: {
          id: true,
          enrolledAt: true,
          trainingSession: {
            select: {
              id: true,
              name: true,
              startDate: true,
              endDate: true,
              status: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
      progress: {
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          percentage: true,
          completedAt: true,
          updatedAt: true,
          lesson: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
      whatsappPreference: true,
    },
  });
}

function create(data) {
  return prisma.user.create({ data: { ...data, role: 'STUDENT' }, select: publicStudentSelect });
}

function update(id, data) {
  return prisma.user.updateMany({ where: { id, role: 'STUDENT' }, data });
}

function setActive(id, isActive) {
  return prisma.user.updateMany({ where: { id, role: 'STUDENT' }, data: { isActive } });
}

function resetPassword(id, passwordHash) {
  return prisma.user.updateMany({ where: { id, role: 'STUDENT' }, data: { passwordHash, mustChangePassword: true } });
}

module.exports = { list, filterOptions, findById, create, update, setActive, resetPassword };
