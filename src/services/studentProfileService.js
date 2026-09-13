const passwords = require('./passwordService');
const prisma = require('../utils/prisma');
const { normalizePhoneNumber } = require('../utils/phone.util');

class StudentProfileError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function getProfile(userId) {
  return prisma.user.findFirst({
    where: { id: userId, role: 'STUDENT', isActive: true },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true, createdAt: true },
  });
}

async function updateProfile(userId, input) {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) throw new StudentProfileError('INVALID_NAME', 'Le nom et le prénom sont obligatoires.');
  let phoneNumber;
  try {
    phoneNumber = normalizePhoneNumber(input.phoneNumber);
  } catch {
    throw new StudentProfileError('INVALID_PHONE', 'Le numéro de téléphone est invalide.');
  }
  const current = await prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true, passwordHash: true } });
  if (!current) throw new StudentProfileError('NOT_FOUND', 'Profil introuvable.', 404);
  if (phoneNumber !== current.phoneNumber) {
    if (!input.currentPassword || !(await passwords.comparePassword(input.currentPassword, current.passwordHash))) {
      throw new StudentProfileError('PASSWORD_REQUIRED', 'Le mot de passe actuel est requis pour modifier le téléphone.');
    }
    const duplicate = await prisma.user.findUnique({ where: { phoneNumber }, select: { id: true } });
    if (duplicate && duplicate.id !== userId) {
      throw new StudentProfileError('PHONE_TAKEN', 'Ce numéro de téléphone est déjà utilisé.');
    }
  }
  return prisma.user.update({
    where: { id: userId },
    data: { firstName, lastName, phoneNumber },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true, createdAt: true },
  });
}

async function changePassword(userId, input, expectedAuthVersion) {
  if (!input.currentPassword) throw new StudentProfileError('CURRENT_REQUIRED', 'Le mot de passe actuel est obligatoire.');
  try {
    passwords.validatePassword(input.newPassword, input.confirmPassword);
  } catch (error) {
    if (!(error instanceof passwords.PasswordError)) throw error;
    throw new StudentProfileError(error.code, error.message);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await passwords.comparePassword(input.currentPassword, user.passwordHash))) {
    throw new StudentProfileError('INVALID_CURRENT', 'Le mot de passe actuel est incorrect.');
  }
  const passwordHash = await passwords.hashPassword(input.newPassword);
  const changed = await passwords.replacePasswordHash(userId, passwordHash, {
    where: { role: 'STUDENT', isActive: true }, expectedPasswordHash: user.passwordHash, expectedAuthVersion,
  });
  if (!changed.count) throw new StudentProfileError('INVALID_CURRENT', 'Votre accès a changé. Reconnectez-vous.', 409);
}

module.exports = { StudentProfileError, getProfile, updateProfile, changePassword };
