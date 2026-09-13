const assert = require('node:assert/strict');

// Existing security tests now seed the required approved request, then use real issuance.
module.exports = async function seedPasswordResetToken(userId) {
  assert.equal(process.env.NODE_ENV, 'test');
  const active = new URL(process.env.DATABASE_URL);
  const target = new URL(process.env.TEST_DATABASE_URL);
  for (const key of ['protocol', 'hostname', 'port', 'username', 'password', 'pathname']) assert.equal(active[key], target[key]);
  assert.equal(decodeURIComponent(active.pathname), '/english_center_test');
  const prisma = require('../../src/utils/prisma');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { authVersion: true } });
  const request = await prisma.passwordResetRequest.create({ data: {
    userId, status: 'APPROVED', reviewedAt: new Date(), authVersionAtRequest: user.authVersion,
  } });
  return (await require('../../src/services/passwordResetService').preparePasswordResetForTest(request.id)).token;
};
