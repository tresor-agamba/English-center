require('dotenv').config();

const { hashPassword } = require('../src/services/passwordService');
const logger = require('../src/services/loggerService');
const { PrismaClient } = require('@prisma/client');
const { normalizePhoneNumber } = require('../src/utils/phone.util');
const { configureLocalDatabaseUrl } = require('../src/utils/databaseUrl.util');

configureLocalDatabaseUrl();
const prisma = new PrismaClient();

async function main() {
  const phoneNumber = normalizePhoneNumber('+243812345678');
  const passwordHash = await hashPassword('Admin@2026');

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { phoneNumber },
      update: { firstName: 'Centre', lastName: 'Administrateur', passwordHash, role: 'ADMIN', authVersion: { increment: 1 } },
      create: { firstName: 'Centre', lastName: 'Administrateur', phoneNumber, passwordHash, role: 'ADMIN' },
      select: { id: true },
    });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  });

  console.log('Administrateur local créé ou mis à jour.');
}

main()
  .catch((error) => {
    logger.error('SEED_FAILED', { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
