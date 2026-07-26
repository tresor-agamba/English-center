const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const notifications = require('./notificationService');

class CertificateError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
function parseId(value, label = 'inscription') {
  const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw new CertificateError('INVALID_ID', `Identifiant de ${label} invalide.`); return id;
}
function amount(value, { nullable = false } = {}) {
  if (nullable && (value === '' || value === null || value === undefined)) return null;
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw)) throw new CertificateError('INVALID_AMOUNT', 'Montant invalide.');
  return new Prisma.Decimal(raw);
}
function currency(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new CertificateError('INVALID_CURRENCY', 'Devise invalide.');
  return code;
}
async function settings(client = prisma) {
  return client.certificateSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}
async function applicableFee(enrollmentId, client = prisma) {
  const enrollment = await client.enrollment.findUnique({
    where: { id: parseId(enrollmentId) },
    select: { id: true, userId: true, trainingSession: { select: { id: true, certificateFee: true, course: { select: { id: true, certificateFee: true } } } } },
  });
  if (!enrollment) throw new CertificateError('NOT_FOUND', 'Inscription introuvable.', 404);
  const config = await settings(client);
  let fee = new Prisma.Decimal(0), source = 'FREE';
  if (config.certificatesPaid) {
    if (enrollment.trainingSession.certificateFee !== null) { fee = enrollment.trainingSession.certificateFee; source = 'SESSION'; }
    else if (enrollment.trainingSession.course.certificateFee !== null) { fee = enrollment.trainingSession.course.certificateFee; source = 'COURSE'; }
    else { fee = config.generalAmount; source = 'GENERAL'; }
  }
  return { amount: fee, currency: config.currency, source, enrollment };
}
async function academicEligibility(enrollmentId, client = prisma) {
  const enrollment = await client.enrollment.findUnique({
    where: { id: parseId(enrollmentId) },
    select: {
      id: true, status: true, trainingSession: { select: { id: true, status: true, courseId: true,
        course: { select: { modules: { where: { isPublished: true }, select: { lessons: { where: { isPublished: true }, select: { id: true } } } } } },
      } },
      lessonProgress: { where: { completedAt: { not: null } }, select: { lessonId: true } },
    },
  });
  if (!enrollment) throw new CertificateError('NOT_FOUND', 'Inscription introuvable.', 404);
  const lessonIds = enrollment.trainingSession.course.modules.flatMap(module => module.lessons.map(lesson => lesson.id));
  const completed = new Set(enrollment.lessonProgress.map(progress => progress.lessonId));
  const valid = enrollment.status === 'CONFIRMED' && enrollment.trainingSession.status === 'COMPLETED' && lessonIds.every(id => completed.has(id));
  return { valid, totalLessons: lessonIds.length, completedLessons: lessonIds.filter(id => completed.has(id)).length, reason: valid ? null : 'La session, l’inscription ou le parcours académique n’est pas terminé.' };
}
async function state(enrollmentId, client = prisma) {
  const [eligibility, fee, request, payment] = await Promise.all([
    academicEligibility(enrollmentId, client), applicableFee(enrollmentId, client),
    client.certificateRequest.findUnique({ where: { enrollmentId: parseId(enrollmentId) }, include: { certificate: true } }),
    client.certificatePayment.findFirst({ where: { enrollmentId: parseId(enrollmentId), status: 'CONFIRMED' }, orderBy: { confirmedAt: 'desc' } }),
  ]);
  let status = 'NOT_ELIGIBLE';
  if (request?.certificate?.status === 'REVOKED') status = 'REVOKED';
  else if (request?.certificate?.status === 'ISSUED') status = 'ISSUED';
  else if (eligibility.valid && (fee.amount.isZero() || payment || request?.isFeeWaived)) status = 'ELIGIBLE_PAYMENT_CONFIRMED';
  else if (eligibility.valid) status = 'ELIGIBLE_PAYMENT_REQUIRED';
  return { eligibility, fee, request, payment, status };
}
async function updateGeneralConfig(body) {
  return prisma.certificateSettings.upsert({ where: { id: 1 }, create: { id: 1, certificatesPaid: body.certificatesPaid === 'on', generalAmount: amount(body.generalAmount), currency: currency(body.currency) }, update: { certificatesPaid: body.certificatesPaid === 'on', generalAmount: amount(body.generalAmount), currency: currency(body.currency) } });
}
async function updateCourseFee(courseId, value) { return prisma.course.update({ where: { id: parseId(courseId, 'formation') }, data: { certificateFee: amount(value, { nullable: true }) } }); }
async function updateSessionFee(sessionId, value) { return prisma.trainingSession.update({ where: { id: parseId(sessionId, 'session') }, data: { certificateFee: amount(value, { nullable: true }) } }); }
async function confirmPayment(enrollmentId, adminId, body = {}) {
  const snapshot = await state(enrollmentId);
  if (!snapshot.eligibility.valid) throw new CertificateError('NOT_ELIGIBLE', 'Cette inscription n’est pas éligible.');
  if (snapshot.fee.amount.isZero()) throw new CertificateError('FREE_CERTIFICATE', 'Aucun paiement n’est requis.');
  if (snapshot.payment) return snapshot.payment;
  const method = String(body.paymentMethod || '').trim();
  if (!method || method.length > 100) throw new CertificateError('PAYMENT_METHOD_REQUIRED', 'Le moyen de paiement est obligatoire.');
  let payment;
  try {
    payment = await prisma.certificatePayment.create({ data: {
      studentId: snapshot.fee.enrollment.userId, enrollmentId: parseId(enrollmentId), amount: snapshot.fee.amount,
      currency: snapshot.fee.currency, status: 'CONFIRMED', paymentMethod: method,
      reference: `CERT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      confirmedAt: new Date(), confirmedByAdminId: adminId,
    } });
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    payment = await prisma.certificatePayment.findUnique({ where: { enrollmentId: Number(enrollmentId) } });
  }
  await notifications.createNotification({ userId: snapshot.fee.enrollment.userId, type: 'CERTIFICATE_PAYMENT_CONFIRMED', title: 'Paiement du certificat confirmé', message: 'Le paiement de votre certificat a été confirmé.', actionUrl: '/student/certificates', relatedEntity: 'ENROLLMENT', relatedId: Number(enrollmentId), deduplicationKey: `CERTIFICATE_PAYMENT_CONFIRMED:payment-${payment.id}` });
  return payment;
}
async function waiveFee(enrollmentId, adminId, reasonValue) {
  const reason = String(reasonValue || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw new CertificateError('WAIVER_REASON_REQUIRED', 'Le motif de l’exonération est obligatoire.');
  const eligibility = await academicEligibility(enrollmentId);
  if (!eligibility.valid) throw new CertificateError('NOT_ELIGIBLE', 'Cette inscription n’est pas éligible.');
  const request = await prisma.certificateRequest.upsert({ where: { enrollmentId: parseId(enrollmentId) }, create: { enrollmentId: Number(enrollmentId), isFeeWaived: true, feeWaivedByAdminId: adminId, feeWaivedAt: new Date(), feeWaiverReason: reason }, update: { isFeeWaived: true, feeWaivedByAdminId: adminId, feeWaivedAt: new Date(), feeWaiverReason: reason } });
  const owner = await prisma.enrollment.findUnique({ where: { id: Number(enrollmentId) }, select: { userId: true } });
  await notifications.createNotification({ userId: owner.userId, type: 'CERTIFICATE_FEE_WAIVED', title: 'Exonération accordée', message: 'Les frais de votre certificat ont été exonérés.', actionUrl: '/student/certificates', relatedEntity: 'ENROLLMENT', relatedId: Number(enrollmentId), deduplicationKey: `CERTIFICATE_FEE_WAIVED:enrollment-${enrollmentId}` });
  return request;
}
async function issue(enrollmentId, adminId) {
  const result = await prisma.$transaction(async tx => {
    const snapshot = await state(enrollmentId, tx);
    if (!snapshot.eligibility.valid) throw new CertificateError('NOT_ELIGIBLE', 'Les conditions académiques ne sont pas remplies.');
    if (!snapshot.fee.amount.isZero() && !snapshot.payment && !snapshot.request?.isFeeWaived) throw new CertificateError('PAYMENT_REQUIRED', 'Le paiement du certificat est requis.');
    const request = await tx.certificateRequest.upsert({ where: { enrollmentId: Number(enrollmentId) }, create: { enrollmentId: Number(enrollmentId) }, update: {} });
    if (snapshot.request?.certificate) throw new CertificateError('ALREADY_ISSUED', 'Un certificat existe déjà pour cette inscription.');
    return tx.certificate.create({ data: { certificateRequestId: request.id, issuedByAdminId: adminId, serialNumber: `EC-${new Date().getFullYear()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}` }, include: { certificateRequest: { include: { enrollment: true } } } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await notifications.createNotification({ userId: result.certificateRequest.enrollment.userId, type: 'CERTIFICATE_ISSUED', title: 'Certificat disponible', message: 'Votre certificat a été émis et est disponible dans votre espace.', actionUrl: '/student/certificates', relatedEntity: 'CERTIFICATE', relatedId: result.id, deduplicationKey: `CERTIFICATE_ISSUED:certificate-${result.id}` });
  return result;
}
async function revoke(certificateId, adminId, reasonValue) {
  const reason = String(reasonValue || '').trim(); if (reason.length < 3) throw new CertificateError('REASON_REQUIRED', 'Le motif de révocation est obligatoire.');
  const certificate = await prisma.certificate.update({ where: { id: parseId(certificateId, 'certificat') }, data: { status: 'REVOKED', revokedAt: new Date(), revokedByAdminId: adminId, revocationReason: reason }, include: { certificateRequest: { include: { enrollment: true } } } });
  await notifications.createNotification({ userId: certificate.certificateRequest.enrollment.userId, type: 'CERTIFICATE_REVOKED', priority: 'HIGH', title: 'Certificat révoqué', message: 'Votre certificat a été révoqué. Contactez l’administration pour plus d’informations.', actionUrl: '/student/certificates', relatedEntity: 'CERTIFICATE', relatedId: certificate.id, deduplicationKey: `CERTIFICATE_REVOKED:certificate-${certificate.id}` });
  return certificate;
}
async function listForAdmin() {
  const enrollments = await prisma.enrollment.findMany({ include: { user: true, trainingSession: { include: { course: true } } }, orderBy: { enrolledAt: 'desc' } });
  return Promise.all(enrollments.map(async enrollment => {
    const snapshot = await state(enrollment.id);
    await notifyEligibility(enrollment.id, snapshot).catch(error => console.error('Notification certificat:', error.message));
    return { enrollment, ...snapshot };
  }));
}
async function listForStudent(userId) {
  const enrollments = await prisma.enrollment.findMany({ where: { userId }, include: { trainingSession: { include: { course: true } } }, orderBy: { enrolledAt: 'desc' } });
  return Promise.all(enrollments.map(async enrollment => {
    const snapshot = await state(enrollment.id);
    await notifyEligibility(enrollment.id, snapshot).catch(error => console.error('Notification certificat:', error.message));
    return { enrollment, ...snapshot };
  }));
}
async function notifyEligibility(enrollmentId, snapshot) {
  if (!snapshot.eligibility.valid || snapshot.request?.certificate) return null;
  const paymentRequired = !snapshot.fee.amount.isZero() && !snapshot.payment && !snapshot.request?.isFeeWaived;
  return notifications.createNotification({
    userId: snapshot.fee.enrollment.userId,
    type: paymentRequired ? 'CERTIFICATE_PAYMENT_REQUIRED' : 'CERTIFICATE_AVAILABLE',
    priority: paymentRequired ? 'HIGH' : 'NORMAL',
    title: paymentRequired ? 'Paiement du certificat requis' : 'Certificat prêt à être demandé',
    message: paymentRequired ? 'Vous êtes éligible au certificat. Le paiement spécifique du certificat est requis avant son émission administrative.' : 'Vous êtes éligible au certificat. Son émission doit maintenant être confirmée par l’administration.',
    actionUrl: '/student/certificates', relatedEntity: 'ENROLLMENT', relatedId: Number(enrollmentId),
    deduplicationKey: `${paymentRequired ? 'CERTIFICATE_PAYMENT_REQUIRED' : 'CERTIFICATE_AVAILABLE'}:enrollment-${enrollmentId}`,
  });
}
module.exports = { CertificateError, parseId, amount, currency, settings, applicableFee, academicEligibility, state, notifyEligibility, updateGeneralConfig, updateCourseFee, updateSessionFee, confirmPayment, waiveFee, issue, revoke, listForAdmin, listForStudent };
