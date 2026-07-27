const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');
const notifications = require('./notificationService');

const FEE_TYPES = Object.freeze(['FORMATION', 'SYLLABUS', 'CERTIFICATE']);
const LEVELS = Object.freeze(['LEVEL_1', 'LEVEL_2', 'LEVEL_3']);
const CURRENCIES = Object.freeze(['USD', 'CDF']);
const METHODS = Object.freeze(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'OTHER']);
class FinanceError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const id = (value) => { const n = Number(value); if (!Number.isInteger(n) || n <= 0) throw new FinanceError('INVALID_ID', 'Identifiant invalide.'); return n; };
const money = (value) => {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new FinanceError('INVALID_AMOUNT', 'Montant invalide.');
  return new Prisma.Decimal(raw);
};
const currency = (value) => { if (!CURRENCIES.includes(value)) throw new FinanceError('INVALID_CURRENCY', 'Devise invalide.'); return value; };
const token = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
async function audit(tx, actorId, entityType, entityId, action, data) {
  return tx.financialAuditLog.create({ data: { actorId: id(actorId), entityType, entityId, action, data } });
}
async function notify(tx, userId, type, relatedEntity, relatedId, title, key) {
  return notifications.createNotificationsForUsers([userId], { type, title, message: title, actionUrl: '/student/finances', relatedEntity, relatedId }, key, tx);
}

async function configureFee(body, actorId) {
  const type = body.type;
  if (!FEE_TYPES.includes(type)) throw new FinanceError('INVALID_FEE_TYPE', 'Type de frais invalide.');
  const level = type === 'FORMATION' && LEVELS.includes(body.level) ? body.level : null;
  if (type === 'FORMATION' && !level) throw new FinanceError('LEVEL_REQUIRED', 'Niveau obligatoire.');
  const data = { type, level, amount: money(body.amount), currency: currency(body.currency), isActive: body.isActive !== false && body.isActive !== 'false' };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.feeConfiguration.findFirst({ where: { type, level } });
    const fee = existing ? await tx.feeConfiguration.update({ where: { id: existing.id }, data }) : await tx.feeConfiguration.create({ data });
    await audit(tx, actorId, 'FEE_CONFIGURATION', fee.id, existing ? 'UPDATED' : 'CREATED', { type, level, amount: data.amount.toString(), currency: data.currency });
    return fee;
  });
}
async function feeFor(type, level, client = prisma) {
  return client.feeConfiguration.findFirst({ where: { type, level: type === 'FORMATION' ? level : null, isActive: true } });
}

async function createInvoice(body, actorId) {
  const studentId = id(body.studentId);
  const enrollmentId = id(body.academicEnrollmentId);
  const requested = [...new Set(Array.isArray(body.types) ? body.types : [body.types])];
  if (!requested.length || requested.some((type) => !FEE_TYPES.includes(type))) throw new FinanceError('INVALID_FEE_TYPE', 'Frais invalides.');
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.academicEnrollment.findFirst({ where: { id: enrollmentId, studentId }, select: { id: true, entryLevel: true, cohort: { select: { level: true } } } });
    if (!enrollment) throw new FinanceError('ENROLLMENT_NOT_FOUND', 'Inscription académique introuvable.', 404);
    const level = enrollment.entryLevel || enrollment.cohort.level;
    const fees = await Promise.all(requested.map((type) => feeFor(type, level, tx)));
    if (fees.some((fee) => !fee)) throw new FinanceError('FEE_NOT_CONFIGURED', 'Un frais demandé n’est pas configuré ou actif.', 409);
    const currencies = new Set(fees.map((fee) => fee.currency));
    if (currencies.size !== 1) throw new FinanceError('MIXED_CURRENCIES', 'Une facture ne peut pas mélanger plusieurs devises.', 409);
    let certificateRequestId = null;
    if (requested.includes('CERTIFICATE')) {
      const request = await tx.certificateRequest.findFirst({ where: { id: id(body.certificateRequestId), enrollment: { userId: studentId } } });
      if (!request) throw new FinanceError('CERTIFICATE_REQUEST_NOT_FOUND', 'Demande de certificat introuvable.', 404);
      certificateRequestId = request.id;
    }
    const total = fees.reduce((sum, fee) => sum.add(fee.amount), new Prisma.Decimal(0));
    const invoice = await tx.studentInvoice.create({ data: {
      number: token('INV'), studentId, academicEnrollmentId: enrollment.id, level,
      totalAmount: total, balanceAmount: total, currency: fees[0].currency,
      lines: { create: fees.map((fee) => ({
        type: fee.type, label: fee.type === 'FORMATION' ? `Formation ${level}` : fee.type === 'SYLLABUS' ? 'Syllabus' : 'Certificat',
        amount: fee.amount, currency: fee.currency, feeConfigurationId: fee.id,
        certificateRequestId: fee.type === 'CERTIFICATE' ? certificateRequestId : null,
      })) },
    }, include: { lines: true } });
    await audit(tx, actorId, 'STUDENT_INVOICE', invoice.id, 'CREATED', { total: total.toString(), currency: invoice.currency });
    await notify(tx, studentId, 'INVOICE_CREATED', 'STUDENT_INVOICE', invoice.id, 'Nouvelle facture disponible', `INVOICE:${invoice.id}:CREATED`);
    return invoice;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function recordPayment(invoiceId, body, actorId) {
  const amount = money(body.amount);
  if (!amount.gt(0)) throw new FinanceError('INVALID_AMOUNT', 'Le montant doit être positif.');
  if (!METHODS.includes(body.method)) throw new FinanceError('INVALID_METHOD', 'Mode de paiement invalide.');
  const key = String(body.idempotencyKey || '').trim();
  if (!key || key.length > 120) throw new FinanceError('IDEMPOTENCY_REQUIRED', 'Clé d’idempotence obligatoire.');
  return prisma.$transaction(async (tx) => {
    const duplicate = await tx.studentPayment.findUnique({ where: { idempotencyKey: key }, include: { receipt: true } });
    if (duplicate) return duplicate;
    const invoice = await tx.studentInvoice.findUnique({ where: { id: id(invoiceId) } });
    if (!invoice || invoice.status === 'CANCELLED') throw new FinanceError('INVOICE_NOT_PAYABLE', 'Facture non payable.', 409);
    if (currency(body.currency) !== invoice.currency) throw new FinanceError('CURRENCY_MISMATCH', 'La devise ne correspond pas à la facture.');
    if (amount.gt(invoice.balanceAmount)) throw new FinanceError('OVERPAYMENT', 'Le montant dépasse le solde.', 409);
    const paid = invoice.paidAmount.add(amount), balance = invoice.totalAmount.sub(paid);
    const status = balance.eq(0) ? 'PAID' : 'PARTIALLY_PAID';
    const payment = await tx.studentPayment.create({ data: {
      invoiceId: invoice.id, amount, currency: invoice.currency, method: body.method, reference: String(body.reference || '').trim() || null,
      idempotencyKey: key, paidAt: body.paidAt ? new Date(body.paidAt) : new Date(), recordedById: id(actorId), comment: String(body.comment || '').trim() || null,
      receipt: { create: { number: token('REC') } },
    }, include: { receipt: true } });
    await tx.studentInvoice.update({ where: { id: invoice.id }, data: { paidAmount: paid, balanceAmount: balance, status } });
    await audit(tx, actorId, 'STUDENT_PAYMENT', payment.id, 'RECORDED', { amount: amount.toString(), currency: invoice.currency });
    await notify(tx, invoice.studentId, 'PAYMENT_RECORDED', 'STUDENT_PAYMENT', payment.id, 'Paiement enregistré', `PAYMENT:${payment.id}:RECORDED`);
    await notify(tx, invoice.studentId, 'RECEIPT_AVAILABLE', 'PAYMENT_RECEIPT', payment.receipt.id, 'Reçu disponible', `RECEIPT:${payment.receipt.id}:AVAILABLE`);
    return payment;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function financialSituation(studentId) {
  const invoices = await prisma.studentInvoice.findMany({ where: { studentId: id(studentId) }, include: { lines: true, payments: { include: { receipt: true }, orderBy: { paidAt: 'desc' } } }, orderBy: { issuedAt: 'desc' } });
  const totals = {};
  for (const invoice of invoices) {
    totals[invoice.currency] ||= { invoiced: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), balance: new Prisma.Decimal(0) };
    totals[invoice.currency].invoiced = totals[invoice.currency].invoiced.add(invoice.totalAmount);
    totals[invoice.currency].paid = totals[invoice.currency].paid.add(invoice.paidAmount);
    totals[invoice.currency].balance = totals[invoice.currency].balance.add(invoice.balanceAmount);
  }
  return { invoices, totals };
}
async function receiptFor(receiptId, requester) {
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id: id(receiptId) }, include: { payment: { include: { invoice: { include: { student: true, lines: true } } } } } });
  if (!receipt || (requester.role === 'STUDENT' && receipt.payment.invoice.studentId !== requester.id) || !['ADMIN', 'STUDENT'].includes(requester.role)) throw new FinanceError('RECEIPT_NOT_FOUND', 'Reçu introuvable.', 404);
  return receipt;
}

module.exports = { FinanceError, FEE_TYPES, LEVELS, CURRENCIES, METHODS, money, configureFee, feeFor, createInvoice, recordPayment, financialSituation, receiptFor };
