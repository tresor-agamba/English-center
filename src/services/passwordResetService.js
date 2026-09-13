const crypto = require('crypto');
const passwords = require('./passwordService');
const prisma = require('../utils/prisma');
const { createPasswordResetRequest } = require('./passwordResetRequestService');
const logger = require('./loggerService');
const policy = require('./passwordResetRequestPolicy');

const TOKEN_TTL_MS = 30 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

class PasswordResetError extends Error {
  constructor() {
    super('Ce lien est invalide ou expiré.');
    this.name = 'PasswordResetError';
    this.code = 'INVALID_TOKEN';
    this.statusCode = 400;
  }
}

// Compatibility entry point: requesting recovery never issues a token.
const requestReset = createPasswordResetRequest;

const requestSelect = { id: true, userId: true, status: true, completedAt: true, authVersionAtRequest: true, requestedAt: true, reviewedAt: true };
const userSelect = { id: true, isActive: true, role: true, authVersion: true };
const transactionOptions = { maxWait: 10000, timeout: 10000 };

function eligible(request, user) {
  return request && user && request.userId === user.id && request.status === 'APPROVED'
    && !policy.isExpired(request) && request.completedAt === null && user.isActive && ['STUDENT', 'TEACHER'].includes(user.role)
    && Number.isInteger(request.authVersionAtRequest) && request.authVersionAtRequest === user.authVersion;
}

async function lockRequest(client, requestId) {
  await client.$queryRaw`SELECT id FROM password_reset_requests WHERE id = ${requestId} FOR UPDATE`;
}

// This raw-token test helper remains isolated even with the production delivery service.
function assertTestDelivery() {
  let allowed = false;
  try {
    const active = new URL(process.env.DATABASE_URL), target = new URL(process.env.TEST_DATABASE_URL);
    allowed = process.env.NODE_ENV === 'test'
      && ['localhost', '127.0.0.1', '[::1]'].includes(active.hostname)
      && decodeURIComponent(active.pathname) === '/english_center_test'
      && ['protocol', 'hostname', 'port', 'username', 'password', 'pathname'].every(key => active[key] === target[key]);
  } catch { /* Invalid configuration fails closed without exposing connection details. */ }
  if (!allowed) {
    const error = new Error('La livraison de test est désactivée dans cet environnement.');
    error.code = 'TEST_DELIVERY_DISABLED';
    throw error;
  }
}

async function preparePasswordResetForTest(requestId) {
  assertTestDelivery();
  if (!Number.isInteger(requestId) || requestId <= 0 || requestId > 2147483647) throw new PasswordResetError();
  await policy.expireRequests(prisma, { id: requestId });
  const delivery = await prisma.$transaction(async (tx) => {
    const [database] = await tx.$queryRaw`SELECT current_database() AS name`;
    if (database.name !== 'english_center_test') throw new PasswordResetError();
    const candidate = await tx.passwordResetRequest.findUnique({ where: { id: requestId }, select: { userId: true } });
    if (!candidate) throw new PasswordResetError();
    await passwords.lockUser(tx, candidate.userId);
    await lockRequest(tx, requestId);
    const request = await tx.passwordResetRequest.findUnique({ where: { id: requestId }, select: requestSelect });
    const user = await tx.user.findUnique({ where: { id: candidate.userId }, select: userSelect });
    return issueToken(tx, request, user);
  }, transactionOptions);
  logger.audit('PASSWORD_RESET_TOKEN_ISSUED', { requestId: delivery.requestId, userId: delivery.userId });
  return delivery;
}

// Internal primitive: caller holds User then Request locks in the same transaction.
// Only the delivery service opts into rotation; the Phase 4 test helper stays single-issue.
async function issueToken(tx, request, user, { rotate = false, deliveryPending = false } = {}) {
  if (!eligible(request, user)) throw new PasswordResetError();
  const existing = await tx.passwordResetToken.findUnique({ where: { requestId: request.id }, select: { id: true } });
  if (existing && !rotate) throw new PasswordResetError();
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date(), expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  const data = { userId: user.id, tokenHash: hashToken(token), createdAt: now, expiresAt, usedAt: null, deliveryPending };
  await tx.passwordResetToken.upsert({ where: { requestId: request.id }, create: { ...data, requestId: request.id }, update: data });
  return { token, requestId: request.id, userId: user.id, expiresAt };
}

async function findValid(token, client = prisma) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (client === prisma) await policy.expireRequests(client, { resetToken: { is: { tokenHash: hashToken(token) } } });
  const record = await client.passwordResetToken.findFirst({
    where: { tokenHash: hashToken(token), usedAt: null, deliveryPending: false, expiresAt: { gt: new Date() }, requestId: { not: null } },
    select: { id: true, userId: true, requestId: true, request: { select: requestSelect }, user: { select: userSelect } },
  });
  if (!record || !eligible(record.request, record.user) || record.request.id !== record.requestId) return null;
  return { id: record.id, userId: record.userId, requestId: record.requestId };
}

async function resetPassword(token, password) {
  // Reject unusable links before paying the bcrypt cost; recheck under locks below.
  if (!(await findValid(token))) throw new PasswordResetError();
  const passwordHash = await passwords.hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const record = await findValid(token, tx);
    if (!record) throw new PasswordResetError();
    await passwords.lockUser(tx, record.userId);
    await lockRequest(tx, record.requestId);
    const current = await findValid(token, tx);
    if (!current || current.id !== record.id || current.userId !== record.userId || current.requestId !== record.requestId) throw new PasswordResetError();
    const now = new Date();
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, userId: record.userId, requestId: record.requestId, tokenHash: hashToken(token), usedAt: null, deliveryPending: false, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new PasswordResetError();
    const changed = await passwords.replacePasswordHash(record.userId, passwordHash, { where: { isActive: true }, mustChangePassword: false }, tx);
    if (changed.count !== 1) throw new PasswordResetError();
    const completed = await tx.passwordResetRequest.updateMany({
      where: { id: record.requestId, userId: record.userId, status: 'APPROVED', completedAt: null },
      data: { status: 'COMPLETED', completedAt: now },
    });
    if (completed.count !== 1) throw new PasswordResetError();
    return { requestId: record.requestId, userId: record.userId };
  }, transactionOptions);
  logger.audit('PASSWORD_RESET_COMPLETED', result);
  return true;
}

module.exports = { TOKEN_TTL_MS, PasswordResetError, hashToken, requestReset, findValid, resetPassword, preparePasswordResetForTest,
  issueToken, eligible, lockRequest, assertTestDelivery };
