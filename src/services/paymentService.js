const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const developmentProvider = require('./paymentProviders/developmentPaymentProvider');
const notificationEvents = require('./notificationEventService');
const enrollmentReminders = require('./enrollmentReminderService');
const trialAccessService = require('./trialAccessService');
const logger = require('./loggerService');

const MAX_TRANSACTION_ATTEMPTS = 8;
const ACTIVE_STATUSES = ['PENDING', 'PROCESSING'];
const ALLOWED_CURRENCIES = ['USD', 'CDF'];

class PaymentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function retryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 20));
}

function parseEnrollmentId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new PaymentError('ENROLLMENT_NOT_FOUND', 'Cette inscription est introuvable.', 404);
  }
  return id;
}

function generateReference() {
  return `ENG-${new Date().getFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

function assertDevelopmentSimulation() {
  if (process.env.NODE_ENV === 'production') {
    throw new PaymentError('SIMULATION_DISABLED', 'Page introuvable.', 404);
  }
}

async function getActiveStudent(userId, client = prisma) {
  const user = await client.user.findFirst({
    where: { id: userId, role: 'STUDENT', isActive: true },
    select: { id: true },
  });
  if (!user) throw new PaymentError('STUDENT_FORBIDDEN', 'Accès interdit.', 403);
  return user;
}

function paymentPublicSelect() {
  return {
    id: true,
    reference: true,
    provider: true,
    amount: true,
    baseAmount: true,
    registrationFee: true,
    currency: true,
    pricingMode: true,
    status: true,
    failureReason: true,
    paidAt: true,
    expiresAt: true,
    createdAt: true,
    metadata: true,
    enrollmentId: true,
    enrollment: {
      select: {
        userId: true,
        status: true,
        trainingSession: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            course: { select: { title: true, slug: true } },
          },
        },
      },
    },
  };
}

async function loadEnrollmentForPayment(client, enrollmentId, userId) {
  const enrollment = await client.enrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      userId: true,
      status: true,
      expectedTotalAmount: true,
      expectedCurrency: true,
      trainingSession: {
        select: {
          id: true,
          status: true,
          startDate: true,
          endDate: true,
          registrationDeadline: true,
          course: {
            select: {
              id: true,
              isPublished: true,
              price: true,
              currency: true,
              pricingMode: true,
              pricingActive: true,
              registrationFee: true,
              pricingStartsAt: true,
              pricingEndsAt: true,
            },
          },
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, reference: true, status: true, expiresAt: true,
          amount: true, currency: true, courseId: true,
        },
      },
    },
  });
  if (!enrollment) throw new PaymentError('ENROLLMENT_NOT_FOUND', 'Cette inscription est introuvable.', 404);
  if (enrollment.userId !== userId) throw new PaymentError('PAYMENT_FORBIDDEN', 'Accès interdit.', 403);
  return enrollment;
}

function validatePayableEnrollment(enrollment, now) {
  if (!['TRIAL_ACTIVE', 'PAYMENT_REQUIRED', 'CONFIRMED'].includes(enrollment.status)) {
    throw new PaymentError('ENROLLMENT_NOT_PAYABLE', 'Cette inscription ne peut pas être payée.');
  }
  const session = enrollment.trainingSession;
  if (!session.course.isPublished || session.endDate < now || !['OPEN', 'FULL', 'ONGOING'].includes(session.status)) {
    throw new PaymentError('SESSION_UNAVAILABLE', 'Cette session n’est plus disponible.');
  }
  const pricing = session.course;
  if (enrollment.expectedTotalAmount !== null && enrollment.expectedCurrency) return;
  if (pricing.price === null || !pricing.pricingMode) throw new PaymentError('PRICE_UNAVAILABLE', 'Le tarif de cette formation n’est pas encore disponible. Veuillez contacter l’administration.');
  if (!pricing.pricingActive) throw new PaymentError('PRICE_INACTIVE', 'Le tarif de cette formation est actuellement indisponible. Veuillez contacter l’administration.');
  if (pricing.pricingStartsAt && pricing.pricingStartsAt > now) throw new PaymentError('PRICE_NOT_STARTED', 'Le tarif de cette formation n’est pas encore applicable.');
  if (pricing.pricingEndsAt && pricing.pricingEndsAt <= now) throw new PaymentError('PRICE_EXPIRED', 'Le tarif de cette formation n’est plus applicable.');
  if (pricing.pricingMode !== 'ONE_TIME') throw new PaymentError('PRICING_MODE_UNSUPPORTED', 'Cette formation doit utiliser un tarif payant unique.');
  if (Number(pricing.price) <= 0 || Number(pricing.registrationFee) < 0) throw new PaymentError('PRICE_INVALID', 'Le tarif payant configuré est invalide.');
  if (!ALLOWED_CURRENCIES.includes(pricing.currency)) throw new PaymentError('CURRENCY_INVALID', 'La devise configurée est invalide.');
}

function requestedPaymentAmount(value, access) {
  const fallback = access.nextRequiredPaymentAmount.gt(0)
    ? access.nextRequiredPaymentAmount
    : access.remainingAmount;
  let amount;
  try {
    amount = value === undefined || value === null || value === ''
      ? fallback
      : new Prisma.Decimal(value);
  } catch {
    throw new PaymentError('PAYMENT_AMOUNT_INVALID', 'Le montant du paiement est invalide.');
  }
  if (!amount.isFinite() || amount.lte(0)) {
    throw new PaymentError('PAYMENT_AMOUNT_INVALID', 'Le montant du paiement doit être supérieur à zéro.');
  }
  if (amount.gt(access.remainingAmount)) {
    logger.security('PAYMENT_OVER_BALANCE_REFUSED', {
      requestedAmount: amount.toString(), remainingAmount: access.remainingAmount.toString(),
    });
    throw new PaymentError('PAYMENT_OVER_BALANCE', 'Le montant dépasse le solde restant.');
  }
  return amount;
}

async function createPaymentAttempt({ userId, enrollmentId: rawEnrollmentId, amount: rawAmount, currency: rawCurrency, flow }) {
  const enrollmentId = parseEnrollmentId(rawEnrollmentId);
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await getActiveStudent(userId, tx);
          const enrollment = await loadEnrollmentForPayment(tx, enrollmentId, userId);
          const now = new Date();

          validatePayableEnrollment(enrollment, now);
          const access = await trialAccessService.calculateTrialAccess(enrollment.id, tx);
          if (access.remainingAmount.lte(0)) return { redirectToEnrollment: true, enrollmentId: enrollment.id };
          const pricing = enrollment.trainingSession.course;
          if (rawCurrency && rawCurrency !== access.expectedCurrency) {
            throw new PaymentError('PAYMENT_CURRENCY_INVALID', 'La devise du paiement ne correspond pas au tarif historique.');
          }
          const active = enrollment.payments.find((payment) => ACTIVE_STATUSES.includes(payment.status));
          if (active && (!active.expiresAt || active.expiresAt > now)) {
            return { paymentReference: active.reference, reused: true };
          }
          if (active) {
            await tx.payment.update({ where: { id: active.id }, data: { status: 'EXPIRED' } });
          }

          const isManual = flow === 'manual';
          const initialized = isManual
            ? { provider: 'manual', expiresAt: null }
            : developmentProvider.initializePayment();
          const amount = requestedPaymentAmount(rawAmount, access);
          const payment = await tx.payment.create({
            data: {
              reference: generateReference(),
              provider: initialized.provider,
              amount,
              baseAmount: access.expectedTotalAmount,
              registrationFee: 0,
              currency: access.expectedCurrency,
              pricingMode: 'ONE_TIME',
              status: isManual ? 'PROCESSING' : 'PENDING',
              expiresAt: initialized.expiresAt,
              enrollmentId: enrollment.id,
              courseId: pricing.id,
              metadata: {
                pricingSnapshotVersion: 2,
                expectedTotalAmount: access.expectedTotalAmount.toString(),
                remainingBeforePayment: access.remainingAmount.toString(),
                paymentChannel: isManual ? 'MANUAL_DECLARATION' : 'DEVELOPMENT_SIMULATION',
              },
            },
            select: { reference: true },
          });
          return { paymentReference: payment.reference, reused: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (['P2002', 'P2034'].includes(error?.code) && attempt < MAX_TRANSACTION_ATTEMPTS) {
        await retryDelay(attempt);
        continue;
      }
      throw error;
    }
  }
  throw new PaymentError('PAYMENT_CONFLICT', 'Impossible de créer le paiement. Veuillez réessayer.');
}

async function getPaymentForStudent(reference, userId) {
  await getActiveStudent(userId);
  let payment = await prisma.payment.findUnique({
    where: { reference },
    select: paymentPublicSelect(),
  });
  if (!payment) throw new PaymentError('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.', 404);
  if (payment.enrollment.userId !== userId) throw new PaymentError('PAYMENT_FORBIDDEN', 'Accès interdit.', 403);
  if (ACTIVE_STATUSES.includes(payment.status) && payment.expiresAt && payment.expiresAt <= new Date()) {
    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'EXPIRED' },
      select: paymentPublicSelect(),
    });
  }
  return { ...payment, access: await trialAccessService.calculateTrialAccess(payment.enrollmentId) };
}

async function simulateSuccess(reference, userId) {
  assertDevelopmentSimulation();
  const result = await prisma.$transaction(async (tx) => {
    await getActiveStudent(userId, tx);
    const payment = await tx.payment.findUnique({
      where: { reference },
      select: {
        id: true, status: true, expiresAt: true, enrollmentId: true, amount: true,
        enrollment: { select: { userId: true } },
      },
    });
    if (!payment) throw new PaymentError('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.', 404);
    if (payment.enrollment.userId !== userId) throw new PaymentError('PAYMENT_FORBIDDEN', 'Accès interdit.', 403);
    if (payment.status === 'SUCCESS') {
      await trialAccessService.calculateTrialAccess(payment.enrollmentId, tx);
      return { paymentId: payment.id, enrollmentId: payment.enrollmentId, success: true };
    }
    if (payment.expiresAt && payment.expiresAt <= new Date()) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      return { paymentId: payment.id, enrollmentId: payment.enrollmentId, expired: true };
    }
    if (!ACTIVE_STATUSES.includes(payment.status)) {
      throw new PaymentError('PAYMENT_NOT_CONFIRMABLE', 'Ce paiement ne peut pas être confirmé.');
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESS', paidAt: new Date(), failureReason: null },
    });
    const access = await trialAccessService.calculateTrialAccess(payment.enrollmentId, tx);
    return { paymentId: payment.id, enrollmentId: payment.enrollmentId, success: true, accessStage: access.accessStage };
  });
  if (result.expired) throw new PaymentError('PAYMENT_EXPIRED', 'Cette tentative de paiement a expiré.');
  if (result.success) {
    const enrollment = await prisma.enrollment.findUnique({ where: { id: result.enrollmentId }, select: { userId: true } });
    await notificationEvents.paymentConfirmed(result.enrollmentId, result.paymentId, enrollment.userId).catch((error) => console.error('Notification paiement:', error.message));
    await enrollmentReminders.synchronizeEnrollmentReminders(result.enrollmentId).catch((error) => console.error('Synchronisation rappels paiement:', error.message));
  }
  return result;
}

async function simulateFailure(reference, userId) {
  assertDevelopmentSimulation();
  return prisma.$transaction(async (tx) => {
    await getActiveStudent(userId, tx);
    const payment = await tx.payment.findUnique({
      where: { reference },
      select: { id: true, status: true, expiresAt: true, enrollmentId: true, enrollment: { select: { userId: true } } },
    });
    if (!payment) throw new PaymentError('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.', 404);
    if (payment.enrollment.userId !== userId) throw new PaymentError('PAYMENT_FORBIDDEN', 'Accès interdit.', 403);
    if (payment.status === 'SUCCESS') return { enrollmentId: payment.enrollmentId, success: true };
    if (payment.expiresAt && payment.expiresAt <= new Date()) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      return { enrollmentId: payment.enrollmentId, expired: true };
    }
    if (payment.status === 'FAILED') return { enrollmentId: payment.enrollmentId, failed: true };
    if (!ACTIVE_STATUSES.includes(payment.status)) {
      throw new PaymentError('PAYMENT_NOT_FAILABLE', 'Ce paiement ne peut pas être marqué comme échoué.');
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failureReason: 'Simulation de paiement échoué' },
    });
    return { enrollmentId: payment.enrollmentId, failed: true };
  });
}

module.exports = {
  PaymentError,
  ACTIVE_STATUSES,
  generateReference,
  createPaymentAttempt,
  getPaymentForStudent,
  simulateSuccess,
  simulateFailure,
  assertDevelopmentSimulation,
};
