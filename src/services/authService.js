const { comparePassword } = require('./passwordService');
const { sessionUser } = require('../middlewares/validateSession');
const prisma = require('../utils/prisma');
const { normalizePhoneNumber } = require('../utils/phone.util');

const DUMMY_PASSWORD_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.1D9H6G7QwGQm8S5F4x1qWHf2xv8B8nS';

async function authenticate(rawPhoneNumber, password) {
  const phoneNumber = normalizePhoneNumber(rawPhoneNumber);
  const user = await prisma.user.findUnique({ where: { phoneNumber } });
  const passwordMatches = await comparePassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);

  if (!user || !user.isActive || !passwordMatches) return null;

  return sessionUser(user);
}

module.exports = { authenticate };
