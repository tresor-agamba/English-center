require('dotenv').config();

const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { normalizePhoneNumber } = require('../src/utils/phone.util');
const { configureLocalDatabaseUrl } = require('../src/utils/databaseUrl.util');

configureLocalDatabaseUrl();
const prisma = new PrismaClient();

async function main() {
  const phoneNumber = normalizePhoneNumber('+243812345678');
  const passwordHash = await bcrypt.hash('Admin@2026', 12);

  await prisma.user.upsert({
    where: { phoneNumber },
    update: { firstName: 'Centre', lastName: 'Administrateur', passwordHash, role: 'ADMIN' },
    create: { firstName: 'Centre', lastName: 'Administrateur', phoneNumber, passwordHash, role: 'ADMIN' },
  });

  console.log('Administrateur local créé ou mis à jour.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
