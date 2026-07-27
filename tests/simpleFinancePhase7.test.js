require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const academic = require('../src/services/academicService');
const finance = require('../src/services/simpleFinanceService');
const receiptPdf = require('../src/services/paymentReceiptPdfService');

const key = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let admin, student, course, cohort, academicEnrollment, legacyEnrollment, certificateRequest, invoice, certificateInvoice, payment;
test('Phase 7 — finances simples', async (t) => {
  admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Finance', phoneNumber: `+243820${key}`, passwordHash: 'x', role: 'ADMIN' } });
  student = await prisma.user.create({ data: { firstName: 'Student', lastName: 'Finance', phoneNumber: `+243821${key}`, passwordHash: 'x', role: 'STUDENT' } });
  course = await prisma.course.create({ data: { title: 'Finance', slug: `finance-${key}`, isPublished: true } });
  cohort = await academic.createCohort({ name: 'Finance', code: `FIN-${key}`, level: 'LEVEL_2', courseId: course.id, startDate: '2026-08-01', endDate: '2026-12-01', capacity: 5, status: 'OPEN' });

  await t.test('inscription académique gratuite sans frais automatique', async () => {
    academicEnrollment = await academic.enrollStudent({ studentId: student.id, cohortId: cohort.id, status: 'ACTIVE' }, admin.id);
    assert.equal(await prisma.studentInvoice.count({ where: { studentId: student.id } }), 0);
  });
  await t.test('configure uniquement formation par niveau, syllabus et certificat', async () => {
    for (const level of finance.LEVELS) await finance.configureFee({ type: 'FORMATION', level, amount: level === 'LEVEL_2' ? '150' : '100', currency: 'USD', isActive: true }, admin.id);
    await finance.configureFee({ type: 'SYLLABUS', amount: '10', currency: 'USD', isActive: true }, admin.id);
    await finance.configureFee({ type: 'CERTIFICATE', amount: '20', currency: 'USD', isActive: true }, admin.id);
    assert.deepEqual(finance.FEE_TYPES, ['FORMATION', 'SYLLABUS', 'CERTIFICATE']);
  });
  await t.test('crée une facture figée formation et syllabus', async () => {
    invoice = await finance.createInvoice({ studentId: student.id, academicEnrollmentId: academicEnrollment.id, types: ['FORMATION', 'SYLLABUS'] }, admin.id);
    assert.equal(invoice.totalAmount.toString(), '160');
    await finance.configureFee({ type: 'FORMATION', level: 'LEVEL_2', amount: '999', currency: 'USD', isActive: true }, admin.id);
    assert.equal((await prisma.studentInvoice.findUnique({ where: { id: invoice.id } })).totalAmount.toString(), '160');
  });
  await t.test('refuse le mélange USD/CDF', async () => {
    await finance.configureFee({ type: 'SYLLABUS', amount: '10000', currency: 'CDF', isActive: true }, admin.id);
    await assert.rejects(() => finance.createInvoice({ studentId: student.id, academicEnrollmentId: academicEnrollment.id, types: ['FORMATION', 'SYLLABUS'] }, admin.id), /devises/);
    await finance.configureFee({ type: 'SYLLABUS', amount: '10', currency: 'USD', isActive: true }, admin.id);
  });
  await t.test('lie le certificat au module existant', async () => {
    const training = await prisma.trainingSession.create({ data: { name: 'Legacy', courseId: course.id, startDate: new Date('2026-01-01'), endDate: new Date('2026-02-01'), registrationDeadline: new Date('2025-12-01'), capacity: 5 } });
    legacyEnrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: training.id, status: 'CONFIRMED' } });
    certificateRequest = await prisma.certificateRequest.create({ data: { enrollmentId: legacyEnrollment.id } });
    certificateInvoice = await finance.createInvoice({ studentId: student.id, academicEnrollmentId: academicEnrollment.id, types: ['CERTIFICATE'], certificateRequestId: certificateRequest.id }, admin.id);
    assert.equal(certificateInvoice.lines[0].certificateRequestId, certificateRequest.id);
  });
  await t.test('gère paiement partiel, plusieurs paiements et solde serveur', async () => {
    payment = await finance.recordPayment(invoice.id, { amount: '60', currency: 'USD', method: 'CASH', idempotencyKey: `pay-a-${key}` }, admin.id);
    let current = await prisma.studentInvoice.findUnique({ where: { id: invoice.id } });
    assert.equal(current.status, 'PARTIALLY_PAID'); assert.equal(current.balanceAmount.toString(), '100');
    await finance.recordPayment(invoice.id, { amount: '100', currency: 'USD', method: 'BANK_TRANSFER', idempotencyKey: `pay-b-${key}` }, admin.id);
    current = await prisma.studentInvoice.findUnique({ where: { id: invoice.id } });
    assert.equal(current.status, 'PAID'); assert.equal(current.balanceAmount.toString(), '0');
  });
  await t.test('paiement idempotent sans double débit', async () => {
    const same = await finance.recordPayment(invoice.id, { amount: '60', currency: 'USD', method: 'CASH', idempotencyKey: `pay-a-${key}` }, admin.id);
    assert.equal(same.id, payment.id);
    assert.equal(await prisma.studentPayment.count({ where: { invoiceId: invoice.id } }), 2);
  });
  await t.test('génère un reçu PDF privé et protège IDOR', async () => {
    const receipt = await finance.receiptFor(payment.receipt.id, { id: student.id, role: 'STUDENT' });
    const buffer = await receiptPdf.generate(receipt);
    assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
    await assert.rejects(() => finance.receiptFor(payment.receipt.id, { id: admin.id, role: 'TEACHER' }), /introuvable/);
  });
  await t.test('sépare la situation USD/CDF et déduplique les notifications', async () => {
    const situation = await finance.financialSituation(student.id);
    assert.ok(situation.totals.USD); assert.equal(situation.totals.CDF, undefined);
    const notes = await prisma.notification.findMany({ where: { userId: student.id, type: { in: ['INVOICE_CREATED', 'PAYMENT_RECORDED', 'RECEIPT_AVAILABLE'] } } });
    assert.equal(new Set(notes.map((n) => n.deduplicationKey)).size, notes.length);
  });

  await prisma.notification.deleteMany({ where: { userId: student.id } });
  await prisma.financialAuditLog.deleteMany({ where: { actorId: admin.id } });
  await prisma.paymentReceipt.deleteMany({ where: { payment: { invoice: { studentId: student.id } } } });
  await prisma.studentPayment.deleteMany({ where: { invoice: { studentId: student.id } } });
  await prisma.studentInvoiceLine.deleteMany({ where: { invoice: { studentId: student.id } } });
  await prisma.studentInvoice.deleteMany({ where: { studentId: student.id } });
  await prisma.feeConfiguration.deleteMany();
  await prisma.certificateRequest.delete({ where: { id: certificateRequest.id } });
  await prisma.enrollment.delete({ where: { id: legacyEnrollment.id } });
  await prisma.trainingSession.deleteMany({ where: { courseId: course.id } });
  await prisma.academicAuditLog.deleteMany({ where: { actorId: admin.id } });
  await prisma.academicEnrollment.delete({ where: { id: academicEnrollment.id } });
  await prisma.academicCohort.delete({ where: { id: cohort.id } });
  await prisma.course.delete({ where: { id: course.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, student.id] } } });
});
