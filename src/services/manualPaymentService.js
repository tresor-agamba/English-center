const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const trialAccessService = require('./trialAccessService');
const notificationService = require('./notificationService');
const enrollmentReminders = require('./enrollmentReminderService');
const centerSettings = require('./centerSettingsService');

const METHOD_DEFINITIONS = [
  ['MPESA', 'M-Pesa', 'MOBILE_MONEY'],
  ['ORANGE_MONEY', 'Orange Money', 'MOBILE_MONEY'],
  ['AIRTEL_MONEY', 'Airtel Money', 'MOBILE_MONEY'],
  ['BANK_TRANSFER', 'Virement bancaire', 'BANK_TRANSFER'],
];
const CURRENCIES = ['USD', 'CDF'];
const METHOD_TYPES = ['MOBILE_MONEY', 'BANK_TRANSFER', 'OTHER'];
const PROOF_ROOT = path.resolve(process.env.PRIVATE_STORAGE_ROOT || path.join(__dirname, '..', '..', 'storage', 'private'), 'payment-proofs');

class ManualPaymentError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message); this.name = 'ManualPaymentError'; this.code = code; this.statusCode = statusCode;
  }
}

const clean = (value, max, required = false) => {
  const result = String(value ?? '').trim();
  if (required && !result) throw new ManualPaymentError('REQUIRED_FIELD', 'Un champ obligatoire est vide.');
  if (result.length > max) throw new ManualPaymentError('VALUE_TOO_LONG', 'Une valeur saisie est trop longue.');
  return result || null;
};
const bool = (value) => value === true || value === 'true' || value === '1' || value === 'on';
const positiveInteger = (value, label) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 1000) throw new ManualPaymentError('INVALID_ORDER', `${label} est invalide.`);
  return result;
};

async function ensureMethods(client = prisma) {
  await Promise.all(METHOD_DEFINITIONS.map(([code, label, type], index) => client.manualPaymentMethod.upsert({
    where: { code }, update: {}, create: { code, label, type, displayOrder: index + 1 },
  })));
}

async function listMethods({ enabledOnly = false, currency } = {}, client = prisma) {
  await ensureMethods(client);
  return client.manualPaymentMethod.findMany({
    where: {
      ...(enabledOnly ? { isEnabled: true, beneficiaryName: { not: null }, accountNumber: { not: null }, instructionsFr: { not: null }, instructionsEn: { not: null } } : {}),
      ...(currency ? { currency } : {}),
    },
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
  });
}

function methodData(source, { creating = false } = {}) {
  const currency = clean(source.currency, 3, true)?.toUpperCase();
  const type = clean(source.type, 30, true)?.toUpperCase();
  if (!CURRENCIES.includes(currency)) throw new ManualPaymentError('INVALID_CURRENCY', 'La devise doit être USD ou CDF.');
  if (!METHOD_TYPES.includes(type)) throw new ManualPaymentError('INVALID_METHOD_TYPE', 'Le type de moyen est invalide.');
  const data = {
    label: clean(source.label, 100, true), type,
    beneficiaryName: clean(source.beneficiaryName, 160), accountNumber: clean(source.accountNumber, 100),
    accountHolder: clean(source.accountHolder, 160), bankName: clean(source.bankName, 160),
    swiftCode: clean(source.swiftCode, 40), bankBranch: clean(source.bankBranch, 160), currency,
    instructionsFr: clean(source.instructionsFr, 1500), instructionsEn: clean(source.instructionsEn, 1500),
    displayOrder: positiveInteger(source.displayOrder, 'Ordre d’affichage'), isEnabled: bool(source.isEnabled),
  };
  if (data.isEnabled && (!data.beneficiaryName || !data.accountNumber || !data.instructionsFr || !data.instructionsEn)) {
    throw new ManualPaymentError('INCOMPLETE_METHOD', 'Un moyen activé doit contenir un bénéficiaire, un numéro et des instructions FR/EN.');
  }
  if (creating) {
    const code = clean(source.code, 40, true)?.toUpperCase().replace(/[ -]+/g, '_');
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) throw new ManualPaymentError('INVALID_CODE', 'Le code du moyen est invalide.');
    data.code = code;
  }
  return data;
}
async function financialAudit(tx, actorId, entityType, entityId, action, data = {}) {
  return tx.financialAuditLog.create({ data: { actorId: Number(actorId), entityType, entityId: Number(entityId), action, data } });
}
async function createMethod(body, adminId) {
  const data = methodData(body, { creating: true });
  return prisma.$transaction(async (tx) => {
    const row = await tx.manualPaymentMethod.create({ data });
    await financialAudit(tx, adminId, 'MANUAL_PAYMENT_METHOD', row.id, 'CREATED', { code: row.code, currency: row.currency, isEnabled: row.isEnabled });
    return row;
  });
}
async function updateMethod(idValue, body, adminId) {
  const id = Number(idValue); if (!Number.isInteger(id) || id < 1) throw new ManualPaymentError('METHOD_NOT_FOUND', 'Moyen introuvable.', 404);
  const data = methodData(body);
  return prisma.$transaction(async (tx) => {
    const before = await tx.manualPaymentMethod.findUnique({ where: { id } });
    if (!before) throw new ManualPaymentError('METHOD_NOT_FOUND', 'Moyen introuvable.', 404);
    data.isEnabled = before.isEnabled;
    const row = await tx.manualPaymentMethod.update({ where: { id }, data });
    await financialAudit(tx, adminId, 'MANUAL_PAYMENT_METHOD', row.id, 'UPDATED', { code: row.code, currency: row.currency, isEnabled: row.isEnabled });
    return row;
  });
}
async function toggleMethod(idValue, enabledValue, confirmed, adminId) {
  const id = Number(idValue); if (!Number.isInteger(id) || id < 1) throw new ManualPaymentError('METHOD_NOT_FOUND', 'Moyen introuvable.', 404);
  const enabled = bool(enabledValue);
  const method = await prisma.manualPaymentMethod.findUnique({ where: { id } });
  if (!method) throw new ManualPaymentError('METHOD_NOT_FOUND', 'Moyen introuvable.', 404);
  if (!enabled) {
    const pending = (await prisma.payment.findMany({ where: { provider: 'manual', status: 'PENDING' }, select: { metadata: true } }))
      .filter((payment) => Number(payment.metadata?.manualMethodId) === id).length;
    if (pending && confirmed !== 'DISABLE_WITH_PENDING') throw new ManualPaymentError('PENDING_METHOD', `${pending} paiement(s) en attente utilisent ce moyen. Confirmez la désactivation.` , 409);
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.manualPaymentMethod.update({ where: { id }, data: { isEnabled: enabled } });
    await financialAudit(tx, adminId, 'MANUAL_PAYMENT_METHOD', id, enabled ? 'ENABLED' : 'DISABLED', { code: row.code });
    return row;
  });
}

async function paymentForStudent(reference, userId) {
  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: { enrollment: { include: { user: true, trainingSession: { include: { course: true } } } } },
  });
  if (!payment) throw new ManualPaymentError('PAYMENT_NOT_FOUND', 'Ce paiement est introuvable.', 404);
  if (payment.enrollment.userId !== Number(userId)) throw new ManualPaymentError('PAYMENT_FORBIDDEN', 'Accès interdit.', 403);
  if (payment.provider !== 'manual') throw new ManualPaymentError('NOT_MANUAL_PAYMENT', 'Ce paiement ne suit pas le parcours manuel.');
  return payment;
}

async function storeProof(file) {
  if (!file) return null;
  if (!file.buffer?.length || file.size > 5 * 1024 * 1024) throw new ManualPaymentError('PROOF_TOO_LARGE', 'La capture doit peser au maximum 5 Mo.');
  const detected = await (await import('file-type')).fileTypeFromBuffer(file.buffer);
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[detected?.mime];
  if (!extension) throw new ManualPaymentError('INVALID_PROOF', 'La preuve doit être un fichier PDF, JPEG, PNG ou WebP.');
  const key = `${crypto.randomUUID()}.${extension}`;
  await fs.mkdir(PROOF_ROOT, { recursive: true });
  await fs.writeFile(path.join(PROOF_ROOT, key), file.buffer, { flag: 'wx' });
  return { key, mimeType: detected.mime, size: file.size };
}

async function declarePayment(reference, userId, body, file) {
  const payment = await paymentForStudent(reference, userId);
  if (payment.status === 'PENDING' && payment.metadata?.manualDeclaredAt) return payment;
  if (payment.status !== 'PROCESSING') throw new ManualPaymentError('PAYMENT_NOT_DECLARABLE', 'Cette tentative ne peut plus être déclarée.');
  const methodCode = clean(body.methodCode, 40, true);
  const method = await prisma.manualPaymentMethod.findFirst({ where: { code: methodCode, isEnabled: true, currency: payment.currency } });
  if (!method) throw new ManualPaymentError('METHOD_UNAVAILABLE', 'Ce moyen de paiement n’est pas disponible.');
  const payerNumber = clean(body.payerNumber, 100, true);
  const transactionReference = clean(body.transactionReference, 160);
  const comment = clean(body.comment, 1000);
  const paidDate = clean(body.paidDate, 10, true);
  const paidTime = clean(body.paidTime, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || (paidTime && !/^\d{2}:\d{2}$/.test(paidTime))) throw new ManualPaymentError('INVALID_PAYMENT_DATE', 'La date ou l’heure du paiement est invalide.');
  const declaredPaidAt = new Date(`${paidDate}T${paidTime || '12:00'}:00`);
  if (Number.isNaN(declaredPaidAt.getTime()) || declaredPaidAt > new Date(Date.now() + 5 * 60000)) throw new ManualPaymentError('INVALID_PAYMENT_DATE', 'La date du paiement est invalide.');
  let sentAmount;
  try { sentAmount = new Prisma.Decimal(body.amount); } catch { throw new ManualPaymentError('INVALID_AMOUNT', 'Le montant envoyé est invalide.'); }
  if (!sentAmount.equals(payment.amount)) throw new ManualPaymentError('AMOUNT_MISMATCH', `Le montant déclaré doit être exactement ${payment.amount} ${payment.currency}.`);
  const proof = await storeProof(file);
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PENDING', providerReference: transactionReference,
          metadata: {
            ...(payment.metadata || {}), manualMethodId: method.id, manualMethodCode: method.code, manualMethodLabel: method.label,
            manualMethodSnapshot: {
              type: method.type, label: method.label, beneficiaryName: method.beneficiaryName,
              accountNumber: method.accountNumber, accountHolder: method.accountHolder, bankName: method.bankName,
              swiftCode: method.swiftCode, bankBranch: method.bankBranch, currency: method.currency,
              instructionsFr: method.instructionsFr, instructionsEn: method.instructionsEn,
            },
            payerNumber, comment, declaredPaidAt: declaredPaidAt.toISOString(), manualDeclaredAt: new Date().toISOString(), proof,
          },
        },
      });
      await financialAudit(tx, userId, 'PAYMENT', payment.id, 'MANUAL_SUBMITTED', { amount: payment.amount.toString(), currency: payment.currency, methodCode: method.code, hasProof: Boolean(proof) });
      return row;
    });
  } catch (error) {
    if (proof) await fs.unlink(path.join(PROOF_ROOT, proof.key)).catch(() => {});
    throw error;
  }
  await notificationService.createNotification({
    userId: payment.enrollment.userId, type: 'MANUAL_PAYMENT_SUBMITTED', title: 'Paiement en attente',
    message: 'Votre paiement a été envoyé pour vérification.', actionUrl: `/payments/${payment.reference}`,
    relatedEntity: 'PAYMENT', relatedId: payment.id, deduplicationKey: `MANUAL_PAYMENT_PENDING:payment-${payment.id}`,
  }).catch(() => {});
  return updated;
}

async function listRequests(filters = {}) {
  const status = ['PENDING', 'SUCCESS', 'FAILED'].includes(filters.status) ? filters.status : 'PENDING';
  const where = {
    provider: 'manual', status,
    ...(CURRENCIES.includes(filters.currency) ? { currency: filters.currency } : {}),
    ...(filters.courseId && Number.isInteger(Number(filters.courseId)) ? { courseId: Number(filters.courseId) } : {}),
    ...(filters.student ? { enrollment: { user: { OR: [
      { firstName: { contains: String(filters.student), mode: 'insensitive' } },
      { lastName: { contains: String(filters.student), mode: 'insensitive' } },
      { phoneNumber: { contains: String(filters.student) } },
    ] } } } : {}),
    ...(filters.from || filters.to ? { createdAt: {
      ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00`) } : {}),
      ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999`) } : {}),
    } } : {}),
  };
  const rows = await prisma.payment.findMany({
    where, orderBy: { createdAt: 'desc' }, take: 200,
    include: { enrollment: { include: { user: true, trainingSession: { include: { course: true } } } } },
  });
  return filters.methodCode ? rows.filter((row) => row.metadata?.manualMethodCode === filters.methodCode) : rows;
}
async function listPending() {
  return prisma.payment.findMany({
    where: { provider: 'manual', status: 'PENDING' }, orderBy: { createdAt: 'asc' },
    include: { enrollment: { include: { user: true, trainingSession: { include: { course: true } } } } },
  });
}
async function pendingCountsByMethod() {
  const rows = await prisma.payment.findMany({ where: { provider: 'manual', status: 'PENDING' }, select: { metadata: true } });
  return rows.reduce((counts, row) => { const id = Number(row.metadata?.manualMethodId); if (id) counts[id] = (counts[id] || 0) + 1; return counts; }, {});
}

async function confirm(reference, adminId) {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { reference }, include: { enrollment: { include: { trainingSession: true } } } });
    if (!payment || payment.provider !== 'manual') throw new ManualPaymentError('PAYMENT_NOT_FOUND', 'Paiement manuel introuvable.', 404);
    if (payment.status === 'SUCCESS') return { payment, access: await trialAccessService.calculateTrialAccess(payment.enrollmentId, tx), unchanged: true };
    if (payment.status !== 'PENDING' || !payment.metadata?.manualDeclaredAt) throw new ManualPaymentError('PAYMENT_NOT_CONFIRMABLE', 'Cette demande ne peut pas être confirmée.');
    const accessBefore = await trialAccessService.calculateTrialAccess(payment.enrollmentId, tx);
    if (payment.currency !== accessBefore.expectedCurrency) throw new ManualPaymentError('CURRENCY_MISMATCH', 'La devise ne correspond plus à l’inscription.', 409);
    if (payment.amount.gt(accessBefore.remainingAmount)) throw new ManualPaymentError('OVERPAYMENT', 'Le montant dépasse le solde actuel.', 409);
    if (payment.courseId !== payment.enrollment.trainingSession.courseId) throw new ManualPaymentError('COURSE_MISMATCH', 'Le paiement ne correspond pas à la formation.', 409);
    const receiptNumber = payment.metadata?.receiptNumber || await centerSettings.getNextReceiptNumber(tx);
    const updated = await tx.payment.update({ where: { id: payment.id }, data: {
      status: 'SUCCESS', paidAt: new Date(), failureReason: null,
      metadata: { ...(payment.metadata || {}), receiptNumber, reviewedByAdminId: Number(adminId), reviewedAt: new Date().toISOString(), reviewDecision: 'CONFIRMED' },
    } });
    await financialAudit(tx, adminId, 'PAYMENT', payment.id, 'MANUAL_CONFIRMED', { amount: payment.amount.toString(), currency: payment.currency, receiptNumber });
    return { payment: updated, access: await trialAccessService.calculateTrialAccess(payment.enrollmentId, tx), userId: payment.enrollment.userId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!result.unchanged) {
    await notificationService.createNotification({
      userId: result.userId, type: 'MANUAL_PAYMENT_CONFIRMED', title: 'Paiement confirmé',
      message: 'Votre paiement a été confirmé. Votre accès a été mis à jour.', actionUrl: `/payments/${reference}`,
      relatedEntity: 'PAYMENT', relatedId: result.payment.id, deduplicationKey: `MANUAL_PAYMENT_CONFIRMED:payment-${result.payment.id}`,
    }).catch(() => {});
    await enrollmentReminders.synchronizeEnrollmentReminders(result.payment.enrollmentId).catch(() => {});
  }
  return result;
}

async function refuse(reference, adminId, reasonValue) {
  const reason = clean(reasonValue, 500, true);
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { reference }, include: { enrollment: true } });
    if (!payment || payment.provider !== 'manual') throw new ManualPaymentError('PAYMENT_NOT_FOUND', 'Paiement manuel introuvable.', 404);
    if (payment.status !== 'PENDING') throw new ManualPaymentError('PAYMENT_NOT_REFUSABLE', 'Cette demande ne peut pas être refusée.');
    const updated = await tx.payment.update({ where: { id: payment.id }, data: {
      status: 'FAILED', failureReason: reason,
      metadata: { ...(payment.metadata || {}), reviewedByAdminId: Number(adminId), reviewedAt: new Date().toISOString(), reviewDecision: 'REFUSED' },
    } });
    await financialAudit(tx, adminId, 'PAYMENT', payment.id, 'MANUAL_REJECTED', { reason });
    return { payment: updated, userId: payment.enrollment.userId };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await notificationService.createNotification({
    userId: result.userId, type: 'MANUAL_PAYMENT_REJECTED', priority: 'HIGH', title: 'Paiement refusé',
    message: 'Votre paiement n’a pas pu être confirmé. Consultez le motif et soumettez une nouvelle preuve.', actionUrl: `/payments/${reference}`,
    relatedEntity: 'PAYMENT', relatedId: result.payment.id, deduplicationKey: `MANUAL_PAYMENT_REFUSED:payment-${result.payment.id}`,
  });
  return result;
}

async function proof(reference, requester = {}) {
  const payment = await prisma.payment.findUnique({ where: { reference }, select: { metadata: true, enrollment: { select: { userId: true } } } });
  if (!payment || (requester.role === 'STUDENT' && payment.enrollment.userId !== Number(requester.id)) || !['ADMIN', 'STUDENT'].includes(requester.role)) throw new ManualPaymentError('PROOF_NOT_FOUND', 'Capture introuvable.', 404);
  const item = payment?.metadata?.proof;
  if (!item?.key) throw new ManualPaymentError('PROOF_NOT_FOUND', 'Aucune capture disponible.', 404);
  const absolutePath = path.resolve(PROOF_ROOT, item.key);
  if (!absolutePath.startsWith(`${PROOF_ROOT}${path.sep}`)) throw new ManualPaymentError('PROOF_NOT_FOUND', 'Capture introuvable.', 404);
  await fs.access(absolutePath).catch(() => { throw new ManualPaymentError('PROOF_NOT_FOUND', 'Capture introuvable.', 404); });
  return { absolutePath, mimeType: item.mimeType };
}
async function receipt(reference, requester = {}) {
  const payment = await prisma.payment.findUnique({ where: { reference }, include: { enrollment: { include: { user: true, trainingSession: { include: { course: true } } } } } });
  if (!payment || payment.provider !== 'manual' || payment.status !== 'SUCCESS' || !payment.metadata?.receiptNumber
    || (requester.role === 'STUDENT' && payment.enrollment.userId !== Number(requester.id)) || !['ADMIN', 'STUDENT'].includes(requester.role)) {
    throw new ManualPaymentError('RECEIPT_NOT_FOUND', 'Reçu introuvable.', 404);
  }
  return payment;
}

module.exports = {
  ManualPaymentError, METHOD_DEFINITIONS, CURRENCIES, METHOD_TYPES, ensureMethods, listMethods,
  createMethod, updateMethod, toggleMethod, paymentForStudent, declarePayment, listRequests, listPending, pendingCountsByMethod, confirm, refuse, proof, receipt,
};
