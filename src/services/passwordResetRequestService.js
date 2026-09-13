const prisma = require('../utils/prisma');
const { normalizePhoneNumber } = require('../utils/phone.util');
const passwords = require('./passwordService');
const logger = require('./loggerService');
const policy = require('./passwordResetRequestPolicy');

async function createPasswordResetRequest(identifier) {
  const accepted = { accepted: true };
  if (typeof identifier !== 'string') return accepted;
  const value = identifier.trim();
  if (!value || value.length > 254) return accepted;
  let where;
  if (value.includes('@')) where = { email: value.toLowerCase() };
  else {
    try { where = { phoneNumber: normalizePhoneNumber(value) }; }
    catch { return accepted; }
  }
  const user = await prisma.user.findUnique({ where, select: { id: true } });
  if (!user) return accepted;
  const created = await prisma.$transaction(async (tx) => {
    // Same per-user lock as Phase 1; recheck eligibility after acquiring it.
    await passwords.lockUser(tx, user.id);
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { role: true, isActive: true, authVersion: true } });
    if (!current?.isActive || !['STUDENT', 'TEACHER'].includes(current.role)) return false;
    await policy.expireRequests(tx, { userId: user.id });
    const pending = await tx.passwordResetRequest.findFirst({ where: { userId: user.id, status: 'PENDING' }, select: { id: true } });
    if (pending) return false;
    return tx.passwordResetRequest.create({ data: { userId: user.id, authVersionAtRequest: current.authVersion }, select: { id: true } });
  }, { maxWait: 10000, timeout: 10000 });
  if (created) logger.audit('PASSWORD_RESET_REQUEST_CREATED', { requestId: created.id, userId: user.id });
  return accepted;
}

const STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'EXPIRED', 'CANCELLED']);
const PAGE_SIZE = 10;
const identitySelect = { id: true, firstName: true, lastName: true, phoneNumber: true, role: true, isActive: true };
const requestSelect = {
  id: true, userId: true, status: true, requestedAt: true, reviewedAt: true,
  reviewedById: true, completedAt: true, createdAt: true, updatedAt: true,
  deliveryChannel: true, deliveryStatus: true, deliveryAttempts: true, deliveryAttemptedAt: true, deliveredAt: true,
  user: { select: identitySelect },
  reviewedBy: { select: { id: true, firstName: true, lastName: true } },
};

class PasswordResetRequestError extends Error {
  constructor(code, statusCode) {
    super(code);
    this.name = 'PasswordResetRequestError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseRequestId(value) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new PasswordResetRequestError('INVALID_ID', 400);
  }
  return Number(value);
}

async function listPasswordResetRequests({ status = 'PENDING', page = 1 } = {}) {
  if (!STATUSES.includes(status)) throw new PasswordResetRequestError('INVALID_STATUS', 400);
  await policy.expireRequests(prisma);
  const requestedPage = Number(page);
  const safePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const total = await prisma.passwordResetRequest.count({ where: { status } });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(safePage, totalPages);
  const requests = await prisma.passwordResetRequest.findMany({
    where: { status }, select: requestSelect, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE, skip: (currentPage - 1) * PAGE_SIZE,
  });
  return { requests, status, total, totalPages, page: currentPage };
}

async function getPasswordResetRequestById(value) {
  await policy.expireRequests(prisma, { id: parseRequestId(value) });
  const request = await prisma.passwordResetRequest.findUnique({
    where: { id: parseRequestId(value) },
    select: { ...requestSelect, user: { select: { ...identitySelect, email: true, whatsappNumber: true } } },
  });
  if (!request) throw new PasswordResetRequestError('NOT_FOUND', 404);
  return request;
}

async function reviewPasswordResetRequest(value, actor, status) {
  const id = parseRequestId(value);
  if (!actor || !Number.isInteger(actor.id) || actor.id <= 0 || !Number.isInteger(actor.authVersion)) {
    throw new PasswordResetRequestError('FORBIDDEN', 403);
  }
  await policy.expireRequests(prisma, { id });
  const decision = await prisma.$transaction(async (tx) => {
    const request = await tx.passwordResetRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!request) throw new PasswordResetRequestError('NOT_FOUND', 404);
    // Stable lock order avoids deadlocks and shares the Phase 1/2 user lock protocol.
    for (const userId of [...new Set([actor.id, request.userId])].sort((a, b) => a - b)) await passwords.lockUser(tx, userId);
    const admin = await tx.user.findUnique({ where: { id: actor.id }, select: { role: true, isActive: true, authVersion: true, mustChangePassword: true } });
    if (!admin?.isActive || admin.role !== 'ADMIN' || admin.mustChangePassword || admin.authVersion !== actor.authVersion) {
      throw new PasswordResetRequestError('FORBIDDEN', 403);
    }
    const current = await tx.passwordResetRequest.findUnique({ where: { id }, select: { status: true, requestedAt: true } });
    if (!current) throw new PasswordResetRequestError('NOT_FOUND', 404);
    if (current.status !== 'PENDING' || policy.isExpired(current)) throw new PasswordResetRequestError('ALREADY_REVIEWED', 409);
    if (status === 'APPROVED') {
      const user = await tx.user.findUnique({ where: { id: request.userId }, select: { isActive: true, role: true } });
      if (!user?.isActive || !['STUDENT', 'TEACHER'].includes(user.role)) throw new PasswordResetRequestError('USER_INELIGIBLE', 409);
    }
    const reviewedAt = new Date();
    const result = await tx.passwordResetRequest.updateMany({
      where: { id, status: 'PENDING' }, data: { status, reviewedById: actor.id, reviewedAt },
    });
    if (result.count !== 1) throw new PasswordResetRequestError('ALREADY_REVIEWED', 409);
    return { id, userId: request.userId, status, reviewedById: actor.id, reviewedAt };
  }, { maxWait: 10000, timeout: 10000 });
  logger.audit(`PASSWORD_RESET_REQUEST_${status}`, { requestId: decision.id, userId: decision.userId, adminId: actor.id });
  return decision;
}

module.exports = {
  createPasswordResetRequest, listPasswordResetRequests, getPasswordResetRequestById,
  approvePasswordResetRequest: (id, actor) => reviewPasswordResetRequest(id, actor, 'APPROVED'),
  rejectPasswordResetRequest: (id, actor) => reviewPasswordResetRequest(id, actor, 'REJECTED'),
  PasswordResetRequestError, STATUSES,
};
