require('dotenv').config();
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const ACCOUNTS = {
  ADMIN: { phoneNumber: '+243899000001', firstName: 'Audit', lastName: 'Administrateur' },
  TEACHER: { phoneNumber: '+243899000002', firstName: 'Audit', lastName: 'Enseignant au nom volontairement très long' },
  STUDENT: { phoneNumber: '+243899000003', firstName: 'Audit', lastName: 'Étudiant au nom volontairement très long' },
};
const PASSWORD = 'Responsive@2026';
async function prepare() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  for (const [role, account] of Object.entries(ACCOUNTS)) await prisma.user.upsert({
    where: { phoneNumber: account.phoneNumber }, update: { ...account, passwordHash, role, isActive: true },
    create: { ...account, passwordHash, role, isActive: true },
  });
  return { ACCOUNTS, PASSWORD };
}
if (require.main === module) prepare().then((data) => console.log(JSON.stringify(data))).catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
module.exports = { prepare, ACCOUNTS, PASSWORD };
