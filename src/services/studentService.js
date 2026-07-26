const prisma = require('../utils/prisma');

const PAGE_SIZE = 10;
const publicStudentSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phoneNumber: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

function buildSearchWhere(search) {
  const value = search.trim();
  if (!value) return { role: 'STUDENT' };

  const phonePart = value.replace(/\D/g, '');
  const or = [
    { firstName: { contains: value, mode: 'insensitive' } },
    { lastName: { contains: value, mode: 'insensitive' } },
  ];
  if (phonePart) or.push({ phoneNumber: { contains: phonePart } });

  return { role: 'STUDENT', OR: or };
}

async function list({ search = '', page = 1 }) {
  const where = buildSearchWhere(search);
  const [students, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: publicStudentSelect,
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
  return prisma.user.updateMany({ where: { id, role: 'STUDENT' }, data: { passwordHash } });
}

module.exports = { list, findById, create, update, setActive, resetPassword };
