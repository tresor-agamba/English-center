const prisma = require('../utils/prisma');
const passwords = require('./passwordService');
const resets = require('./passwordResetService');
const logger = require('./loggerService');
const policy = require('./passwordResetRequestPolicy');
const emailProvider = require('./emailDeliveryProvider');
const { renderResetEmail } = require('./passwordResetEmailTemplate');
const { ResetDeliveryError, resetEmail, appBaseUrl, buildResetLink } = require('../utils/resetDeliveryConfig');

const RETRY_DELAY_MS = 30000;
const DELIVERY_LEASE_MS = 120000;
const transactionOptions = { maxWait: 10000, timeout: 10000 };
const userSelect = { id: true, role: true, isActive: true, authVersion: true, mustChangePassword: true, email: true, firstName: true };
let testProvider;

function setEmailProviderForTest(provider) {
  resets.assertTestDelivery();
  if (provider !== null && typeof provider?.send !== 'function') throw new ResetDeliveryError('EMAIL_NOT_CONFIGURED', 503);
  testProvider = provider;
}
function provider() {
  if (testProvider) { resets.assertTestDelivery(); return testProvider; }
  return emailProvider.createEmailDeliveryProvider();
}
function validActor(user, actor) {
  return user?.isActive && user.role === 'ADMIN' && !user.mustChangePassword && user.authVersion === actor.authVersion;
}
async function lockUsers(tx, adminId, userId) {
  for (const id of [...new Set([adminId, userId])].sort((a, b) => a - b)) await passwords.lockUser(tx, id);
}
function audit(action, claim) {
  logger.audit(action, { adminId: claim.adminId, requestId: claim.requestId, userId: claim.userId, channel: 'EMAIL', result: action.endsWith('_SENT') ? 'SENT' : 'FAILED' });
}

async function finish(claim, actor, accepted) {
  return prisma.$transaction(async tx => {
    await lockUsers(tx, actor.id, claim.userId);
    await resets.lockRequest(tx, claim.requestId);
    const request = await tx.passwordResetRequest.findUnique({ where: { id: claim.requestId } });
    // A delayed worker must never finalize or invalidate a newer attempt.
    if (!request || request.deliveryAttempts !== claim.attempt || request.deliveryStatus !== 'SENDING') return false;
    const user = await tx.user.findUnique({ where: { id: claim.userId }, select: userSelect });
    const admin = await tx.user.findUnique({ where: { id: actor.id }, select: userSelect });
    const token = await tx.passwordResetToken.findUnique({ where: { requestId: claim.requestId } });
    const now = new Date();
    const sent = Boolean(accepted && validActor(admin, actor) && resets.eligible(request, user)
      && resetEmail(user.email) === claim.email && token?.tokenHash === claim.tokenHash && token.userId === claim.userId
      && token.usedAt === null && token.deliveryPending && token.expiresAt > now
      && request.deliveryAttemptedAt.getTime() > now.getTime() - DELIVERY_LEASE_MS);
    await tx.passwordResetToken.updateMany({ where: { requestId: claim.requestId, tokenHash: claim.tokenHash, usedAt: null },
      data: sent ? { deliveryPending: false } : { usedAt: now } });
    await tx.passwordResetRequest.update({ where: { id: claim.requestId },
      data: { deliveryStatus: sent ? 'SENT' : 'FAILED', deliveredAt: sent ? now : null } });
    return sent;
  }, transactionOptions);
}

async function deliverApprovedResetRequest(value, actor, { channel = 'EMAIL' } = {}) {
  if (!actor || !Number.isInteger(actor.id) || actor.id <= 0 || !Number.isInteger(actor.authVersion)) throw new ResetDeliveryError('FORBIDDEN', 403);
  if (channel !== 'EMAIL') throw new ResetDeliveryError('CHANNEL_UNAVAILABLE', 400);
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw new ResetDeliveryError('INVALID_ID', 400);
  const requestId = Number(value);
  await policy.expireRequests(prisma, { id: requestId });
  const claim = await prisma.$transaction(async tx => {
    const candidate = await tx.passwordResetRequest.findUnique({ where: { id: requestId }, select: { userId: true } });
    if (!candidate) throw new ResetDeliveryError('NOT_FOUND', 404);
    await lockUsers(tx, actor.id, candidate.userId);
    await resets.lockRequest(tx, requestId);
    const admin = await tx.user.findUnique({ where: { id: actor.id }, select: userSelect });
    if (!validActor(admin, actor)) throw new ResetDeliveryError('FORBIDDEN', 403);
    const request = await tx.passwordResetRequest.findUnique({ where: { id: requestId } });
    const user = await tx.user.findUnique({ where: { id: candidate.userId }, select: userSelect });
    if (!resets.eligible(request, user)) throw new ResetDeliveryError('DELIVERY_INELIGIBLE');
    const email = resetEmail(user.email);
    if (!email) throw new ResetDeliveryError(user.email ? 'INVALID_EMAIL' : 'NO_EMAIL');
    const base = appBaseUrl(), transport = provider(); // Validate readiness before minting anything.
    const now = new Date();
    const busy = await tx.passwordResetRequest.findFirst({ where: { userId: user.id, deliveryStatus: 'SENDING', deliveryAttemptedAt: { gt: new Date(now.getTime() - DELIVERY_LEASE_MS) } }, select: { id: true } });
    if (busy) throw new ResetDeliveryError('DELIVERY_BUSY');
    const recent = await tx.passwordResetRequest.findFirst({ where: { userId: user.id, deliveryAttemptedAt: { gt: new Date(now.getTime() - RETRY_DELAY_MS) } }, select: { id: true } });
    if (recent) throw new ResetDeliveryError('DELIVERY_RATE_LIMITED', 429);
    // Recovery from a crashed worker: all its pending tokens are invalidated by issueToken.
    await tx.passwordResetRequest.updateMany({ where: { userId: user.id, deliveryStatus: 'SENDING' }, data: { deliveryStatus: 'FAILED', deliveredAt: null } });
    const delivery = await resets.issueToken(tx, request, user, { rotate: true, deliveryPending: true });
    const saved = await tx.passwordResetRequest.update({ where: { id: requestId }, data: {
      deliveryChannel: 'EMAIL', deliveryStatus: 'SENDING', deliveryAttempts: { increment: 1 }, deliveryAttemptedAt: now, deliveredAt: null,
    } });
    return { requestId, userId: user.id, adminId: actor.id, attempt: saved.deliveryAttempts, tokenHash: resets.hashToken(delivery.token), email, transport,
      message: { to: email, ...renderResetEmail({ firstName: user.firstName, link: buildResetLink(base, delivery.token) }) } };
  }, transactionOptions);

  logger.audit('PASSWORD_RESET_TOKEN_ISSUED', { requestId: claim.requestId, userId: claim.userId });
  let sent = false;
  try {
    let accepted = false;
    try { accepted = (await claim.transport.send(claim.message))?.accepted === true; }
    catch { /* Never log provider errors: arbitrary messages may include secrets. */ }
    sent = await finish(claim, actor, accepted);
  } catch {
    // Even when PostgreSQL is unavailable, deliveryPending keeps the token unusable.
    try { await finish(claim, actor, false); } catch { /* Retry after lease expiry remains safe. */ }
  } finally {
    claim.message = null; claim.transport = null; claim.email = null;
  }
  audit(sent ? 'PASSWORD_RESET_DELIVERY_SENT' : 'PASSWORD_RESET_DELIVERY_FAILED', claim);
  if (!sent) throw new ResetDeliveryError('DELIVERY_FAILED', 503);
  return { requestId: claim.requestId, channel: 'EMAIL', status: 'SENT' };
}

module.exports = { deliverApprovedResetRequest, setEmailProviderForTest, RETRY_DELAY_MS, DELIVERY_LEASE_MS, ResetDeliveryError };
