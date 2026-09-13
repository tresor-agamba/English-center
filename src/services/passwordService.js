const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');

const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_COST = 12;
const PASSWORD_MAX_BYTES = 72;

class PasswordError extends Error {
  constructor(message, code = 'INVALID_PASSWORD', statusCode = 400) {
    super(message);
    this.name = 'PasswordError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validatePassword(password, confirmation) {
  if (typeof password !== 'string' || Array.from(password).length < PASSWORD_MIN_LENGTH) {
    throw new PasswordError(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new PasswordError('Le mot de passe ne doit pas dépasser 72 octets UTF-8.');
  }
  if (arguments.length > 1 && (typeof confirmation !== 'string' || password !== confirmation)) {
    throw new PasswordError('Les mots de passe ne correspondent pas.');
  }
  return password;
}

function hashPassword(password) {
  validatePassword(password);
  return bcrypt.hash(password, PASSWORD_COST);
}

// Login must also accept passwords created before the current length policy.
function comparePassword(password, passwordHash) {
  if (typeof password !== 'string' || typeof passwordHash !== 'string') return Promise.resolve(false);
  return bcrypt.compare(password, passwordHash);
}

async function lockUser(client, userId) {
  await client.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

// All existing-account password writes use this transaction, including token resets.
async function replacePasswordHash(userId, passwordHash, options = {}, client) {
  const run = async (tx) => {
    await lockUser(tx, userId);
    const where = { id: userId };
    for (const key of ['role', 'isActive', 'mustChangePassword']) {
      if (options.where?.[key] !== undefined) where[key] = options.where[key];
    }
    if (options.expectedAuthVersion !== undefined) where.authVersion = options.expectedAuthVersion;
    if (options.expectedPasswordHash !== undefined) where.passwordHash = options.expectedPasswordHash;
    const data = { passwordHash, authVersion: { increment: 1 } };
    if (options.mustChangePassword !== undefined) data.mustChangePassword = options.mustChangePassword;
    if (options.identity) {
      for (const key of ['firstName', 'lastName', 'phoneNumber']) data[key] = options.identity[key];
    }
    const result = await tx.user.updateMany({ where, data });
    if (result.count) {
      await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    }
    return result;
  };
  return client ? run(client) : prisma.$transaction(run);
}

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_COST, PASSWORD_MAX_BYTES, PasswordError, validatePassword, hashPassword, comparePassword, lockUser, replacePasswordHash };
