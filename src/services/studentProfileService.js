const bcrypt = require('bcrypt');
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
    if (!input.currentPassword || !(await bcrypt.compare(input.currentPassword, current.passwordHash))) {
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

async function changePassword(userId, input) {
  if (!input.currentPassword) throw new StudentProfileError('CURRENT_REQUIRED', 'Le mot de passe actuel est obligatoire.');
  if (!input.newPassword || input.newPassword.length < 10) {
    throw new StudentProfileError('WEAK_PASSWORD', 'Le nouveau mot de passe doit contenir au moins 10 caractères.');
  }
  if (input.newPassword !== input.confirmPassword) {
    throw new StudentProfileError('PASSWORD_MISMATCH', 'La confirmation du mot de passe ne correspond pas.');
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new StudentProfileError('INVALID_CURRENT', 'Le mot de passe actuel est incorrect.');
  }
  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

module.exports = { StudentProfileError, getProfile, updateProfile, changePassword };
