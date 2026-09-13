require('dotenv').config();
const { hashPassword } = require('../src/services/passwordService');
const logger = require('../src/services/loggerService');
const prisma = require('../src/utils/prisma');
const ACCOUNTS = {
  ADMIN: { phoneNumber: '+243899000001', firstName: 'Audit', lastName: 'Administrateur' },
  TEACHER: { phoneNumber: '+243899000002', firstName: 'Audit', lastName: 'Enseignant au nom volontairement très long' },
  STUDENT: { phoneNumber: '+243899000003', firstName: 'Audit', lastName: 'Étudiant au nom volontairement très long' },
};
const PASSWORD = 'Responsive@2026';
async function prepare() {
  const passwordHash = await hashPassword(PASSWORD);
  for (const [role, account] of Object.entries(ACCOUNTS)) await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { phoneNumber: account.phoneNumber }, update: { ...account, passwordHash, role, isActive: true, authVersion: { increment: 1 } },
      create: { ...account, passwordHash, role, isActive: true }, select: { id: true },
    });
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  });
  return { ACCOUNTS, PASSWORD };
}
if (require.main === module) prepare().then(() => logger.info('AUDIT_ACCOUNTS_PREPARED', { roles: Object.keys(ACCOUNTS) })).catch((error) => { logger.error('AUDIT_PREPARE_FAILED', { error }); process.exitCode = 1; }).finally(() => prisma.$disconnect());
module.exports = { prepare, ACCOUNTS, PASSWORD };
