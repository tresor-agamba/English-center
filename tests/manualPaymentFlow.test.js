const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const paymentService = require('../src/services/paymentService');
const manualPayments = require('../src/services/manualPaymentService');
const accessService = require('../src/services/trialAccessService');
const fs = require('fs/promises');
const receiptPdf = require('../src/services/paymentReceiptPdfService');

test('paiements manuels : déclaration, validation, refus et paliers existants', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  let student;
  let admin;
  let otherStudent;
  let course;
  let customMethodId;
  let proofPath;

  async function enrollment(label, attendanceCount) {
    const session = await prisma.trainingSession.create({ data: {
      name: `Manuel ${label} ${key}`, courseId: course.id,
      startDate: new Date(Date.now() - 86400000), endDate: new Date(Date.now() + 30 * 86400000),
      registrationDeadline: new Date(Date.now() - 2 * 86400000), capacity: 20, status: 'OPEN',
    } });
    const row = await prisma.enrollment.create({ data: {
      userId: student.id, trainingSessionId: session.id, status: 'TRIAL_ACTIVE',
      expectedTotalAmount: 100, expectedCurrency: 'USD',
    } });
    for (let index = 1; index <= attendanceCount; index += 1) {
      const meeting = await prisma.classMeeting.create({ data: {
        title: `Séance ${index}`, trainingSessionId: session.id,
        startsAt: new Date(Date.now() - index * 3600000), endsAt: new Date(Date.now() - index * 3600000 + 1800000),
        privateMeetingUrl: `https://meet.example.test/${key}-${label}-${index}`,
      } });
      await prisma.attendance.create({ data: { enrollmentId: row.id, classMeetingId: meeting.id, status: 'PRESENT' } });
    }
    return row;
  }

  async function createAndDeclare(row, amount, suffix) {
    const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: row.id, amount, currency: 'USD', flow: 'manual' });
    const created = await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } });
    assert.equal(created.status, 'PROCESSING');
    assert.equal(created.provider, 'manual');
    await manualPayments.declarePayment(attempt.paymentReference, student.id, {
      methodCode: 'MPESA', payerNumber: `+24397000${suffix}`, amount: String(amount), transactionReference: `TX-${suffix}`,
      paidDate: new Date().toISOString().slice(0, 10),
    });
    const declared = await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } });
    assert.equal(declared.status, 'PENDING');
    assert.equal(declared.metadata.manualMethodCode, 'MPESA');
    return declared;
  }

  try {
    student = await prisma.user.create({ data: { firstName: 'Manuel', lastName: 'Étudiant', phoneNumber: `+243970${String(Date.now()).slice(-6)}`, passwordHash: 'test', role: 'STUDENT' } });
    admin = await prisma.user.create({ data: { firstName: 'Manuel', lastName: 'Admin', phoneNumber: `+243971${String(Date.now()).slice(-6)}`, passwordHash: 'test', role: 'ADMIN' } });
    otherStudent = await prisma.user.create({ data: { firstName: 'Autre', lastName: 'Étudiant', phoneNumber: `+243972${String(Date.now()).slice(-6)}`, passwordHash: 'test', role: 'STUDENT' } });
    course = await prisma.course.create({ data: {
      title: `Paiement manuel ${key}`, slug: `paiement-manuel-${key}`, price: 100, currency: 'USD',
      pricingMode: 'ONE_TIME', pricingActive: true, registrationFee: 0, isPublished: true,
    } });
    await manualPayments.ensureMethods();
    await prisma.manualPaymentMethod.update({ where: { code: 'MPESA' }, data: {
      isEnabled: true, beneficiaryName: 'New Vision Academy', accountNumber: '+243970000000', currency: 'USD', displayOrder: 1,
      instructionsFr: 'Envoyer le montant exact.', instructionsEn: 'Send the exact amount.',
    } });

    await t.test('administrateur crée, modifie, active et désactive un moyen', async () => {
      const created = await manualPayments.createMethod({ code: `OTHER_${String(Date.now()).slice(-6)}`, label: 'Paiement bureau', type: 'OTHER', currency: 'USD', beneficiaryName: 'NVA', accountNumber: 'BUREAU-01', instructionsFr: 'Présentez la référence.', instructionsEn: 'Present the reference.', displayOrder: 20 }, admin.id);
      customMethodId = created.id;
      const updated = await manualPayments.updateMethod(created.id, { label: 'Paiement au bureau', type: 'OTHER', currency: 'USD', beneficiaryName: 'NVA', accountNumber: 'BUREAU-02', instructionsFr: 'Présentez la référence.', instructionsEn: 'Present the reference.', displayOrder: 19 }, admin.id);
      assert.equal(updated.accountNumber, 'BUREAU-02');
      assert.equal((await manualPayments.toggleMethod(created.id, true, '', admin.id)).isEnabled, true);
      assert.equal((await manualPayments.toggleMethod(created.id, false, '', admin.id)).isEnabled, false);
      assert.equal((await manualPayments.listMethods({ enabledOnly: true, currency: 'USD' })).some((method) => method.code === 'MPESA'), true);
      assert.equal((await manualPayments.listMethods({ enabledOnly: true, currency: 'CDF' })).some((method) => method.code === 'MPESA'), false);
    });

    await t.test('crée uniquement PROCESSING puis PENDING après déclaration', async () => {
      const row = await enrollment('pending', 5);
      const payment = await createAndDeclare(row, 50, '01');
      assert.equal((await manualPayments.listPending()).some((item) => item.id === payment.id), true);
      await manualPayments.declarePayment(payment.reference, student.id, { methodCode: 'MPESA', payerNumber: '+243970000001', amount: '50', paidDate: new Date().toISOString().slice(0, 10) });
      assert.equal(await prisma.notification.count({ where: { deduplicationKey: `MANUAL_PAYMENT_PENDING:payment-${payment.id}` } }), 1);
      assert.equal((await accessService.calculateTrialAccess(row.id)).accessStage, 'PAYMENT_REQUIRED_50');
    });

    await t.test('stocke la preuve hors public et bloque l’IDOR étudiant', async () => {
      const row = await enrollment('proof', 5);
      const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: row.id, amount: 50, currency: 'USD', flow: 'manual' });
      const buffer = await fs.readFile('public/icons/icon-192.png');
      await manualPayments.declarePayment(attempt.paymentReference, student.id, { methodCode: 'MPESA', payerNumber: '+243970000099', amount: '50', paidDate: new Date().toISOString().slice(0, 10) }, { buffer, size: buffer.length, mimetype: 'image/png', originalname: 'preuve.png' });
      const ownerProof = await manualPayments.proof(attempt.paymentReference, { id: student.id, role: 'STUDENT' }); proofPath = ownerProof.absolutePath;
      assert.doesNotMatch(ownerProof.absolutePath, /public[\\/]/); assert.equal((await manualPayments.proof(attempt.paymentReference, { id: admin.id, role: 'ADMIN' })).absolutePath, ownerProof.absolutePath);
      await assert.rejects(() => manualPayments.proof(attempt.paymentReference, { id: otherStudent.id, role: 'STUDENT' }), (error) => error.code === 'PROOF_NOT_FOUND');
    });

    await t.test('confirmation admin passe SUCCESS et déverrouille le palier 50 %', async () => {
      const row = await enrollment('half', 5);
      const payment = await createAndDeclare(row, 50, '02');
      const result = await manualPayments.confirm(payment.reference, admin.id);
      await manualPayments.confirm(payment.reference, admin.id);
      assert.equal(result.payment.status, 'SUCCESS');
      assert.equal(await prisma.notification.count({ where: { deduplicationKey: `MANUAL_PAYMENT_CONFIRMED:payment-${payment.id}` } }), 1);
      assert.ok(result.payment.metadata.receiptNumber);
      const receipt = await manualPayments.receipt(payment.reference, { id: student.id, role: 'STUDENT' });
      assert.ok((await receiptPdf.generateManual(receipt)).length > 1000);
      const access = await accessService.calculateTrialAccess(row.id);
      assert.equal(access.confirmedPaidAmount.toString(), '50');
      assert.equal(access.accessStage, 'PARTIAL_ACCESS');
      assert.equal(access.allowed, true);
    });

    await t.test('deux paiements confirmés cumulent 100 % et débloquent la suite', async () => {
      const row = await enrollment('full', 10);
      const first = await createAndDeclare(row, 50, '03'); await manualPayments.confirm(first.reference, admin.id);
      assert.equal((await accessService.calculateTrialAccess(row.id)).accessStage, 'PAYMENT_REQUIRED_FULL');
      const second = await createAndDeclare(row, 50, '04'); await manualPayments.confirm(second.reference, admin.id);
      const access = await accessService.calculateTrialAccess(row.id);
      assert.equal(access.confirmedPaidAmount.toString(), '100');
      assert.equal(access.accessStage, 'FULL_ACCESS');
      assert.equal(access.allowed, true);
    });

    await t.test('refus admin conserve les montants et enregistre le motif', async () => {
      const row = await enrollment('refused', 5);
      const payment = await createAndDeclare(row, 50, '05');
      await manualPayments.refuse(payment.reference, admin.id, 'Référence introuvable');
      const refused = await prisma.payment.findUnique({ where: { id: payment.id } });
      assert.equal(refused.status, 'FAILED');
      assert.equal(refused.failureReason, 'Référence introuvable');
      assert.equal((await accessService.calculateTrialAccess(row.id)).confirmedPaidAmount.toString(), '0');
    });

    await t.test('refuse montant falsifié et confirmation avant déclaration', async () => {
      const row = await enrollment('security', 5);
      const attempt = await paymentService.createPaymentAttempt({ userId: student.id, enrollmentId: row.id, amount: 50, currency: 'USD', flow: 'manual' });
      await assert.rejects(() => manualPayments.declarePayment(attempt.paymentReference, student.id, { methodCode: 'MPESA', payerNumber: '+243970000001', amount: '49', paidDate: new Date().toISOString().slice(0, 10) }), (error) => error.code === 'AMOUNT_MISMATCH');
      await assert.rejects(() => manualPayments.confirm(attempt.paymentReference, admin.id), (error) => error.code === 'PAYMENT_NOT_CONFIRMABLE');
      assert.equal((await prisma.payment.findUnique({ where: { reference: attempt.paymentReference } })).status, 'PROCESSING');
    });
  } finally {
    if (customMethodId) await prisma.manualPaymentMethod.delete({ where: { id: customMethodId } }).catch(() => {});
    if (course) await prisma.course.delete({ where: { id: course.id } }).catch(() => {});
    await prisma.financialAuditLog.deleteMany({ where: { actorId: { in: [student?.id, admin?.id].filter(Boolean) } } }).catch(() => {});
    if (proofPath) await fs.unlink(proofPath).catch(() => {});
    if (student) await prisma.user.delete({ where: { id: student.id } }).catch(() => {});
    if (otherStudent) await prisma.user.delete({ where: { id: otherStudent.id } }).catch(() => {});
    if (admin) await prisma.user.delete({ where: { id: admin.id } }).catch(() => {});
    await prisma.manualPaymentMethod.updateMany({ data: { isEnabled: false } }).catch(() => {});
    await prisma.$disconnect();
  }
});
