const prisma = require('../utils/prisma');

async function listStudentPayments(userId) {
  return prisma.payment.findMany({
    where: { enrollment: { userId } },
    orderBy: { createdAt: 'desc' },
    select: {
      reference: true,
      amount: true,
      currency: true,
      status: true,
      failureReason: true,
      paidAt: true,
      expiresAt: true,
      createdAt: true,
      enrollment: {
        select: {
          id: true,
          trainingSession: { select: { course: { select: { title: true } } } },
        },
      },
    },
  });
}

module.exports = { listStudentPayments };
