const crypto = require('crypto');
const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');
const { normalizePhoneNumber } = require('../utils/phone.util');

const TOKEN_TTL_MS = 30 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function requestReset(identifier) {
  const value = String(identifier || '').trim();
  let user = null;
  if (value.includes('@')) user = await prisma.user.findUnique({ where: { email: value.toLowerCase() }, select: { id: true, email: true, phoneNumber: true } });
  else {
    try { user = await prisma.user.findUnique({ where: { phoneNumber: normalizePhoneNumber(value) }, select: { id: true, email: true, phoneNumber: true } }); } catch { user = null; }
  }
  if (!user || !user.email) return { accepted: true, delivery: null };
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS) } }),
  ]);
  return { accepted: true, delivery: { channel: 'EMAIL_PENDING', recipient: user.email, token } };
}

function findValid(token, client = prisma) {
  if (!token || token.length > 200) return null;
  return client.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userId: true } });
}

async function resetPassword(token, password) {
  if (!password || password.length < 8) throw Object.assign(new Error('Le mot de passe doit contenir au moins 8 caractères.'), { code: 'INVALID_PASSWORD' });
  return prisma.$transaction(async (tx) => {
    const record = await findValid(token, tx);
    if (!record) throw Object.assign(new Error('Ce lien est invalide ou expiré.'), { code: 'INVALID_TOKEN' });
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw Object.assign(new Error('Ce lien est invalide ou expiré.'), { code: 'INVALID_TOKEN' });
    const passwordHash = await bcrypt.hash(password, 12);
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash, mustChangePassword: false } });
    await tx.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: new Date() } });
    return true;
  });
}

module.exports = { TOKEN_TTL_MS, hashToken, requestReset, findValid, resetPassword };
