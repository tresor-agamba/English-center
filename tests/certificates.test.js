const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/utils/prisma');
const service = require('../src/services/certificateService');

test('frais et émission manuelle des certificats', async (t) => {
  const key = `${Date.now()}-${process.pid}`;
  const userIds = [], courseIds = [];
  const originalSettings = await service.settings();
  async function user(index, role = 'STUDENT') {
    const row = await prisma.user.create({ data: { firstName: 'Certificat', lastName: `Test${index}`, phoneNumber: `+1202777${index}${key.slice(-4)}`, passwordHash: 'test', role } });
    userIds.push(row.id); return row;
  }
  try {
    const admin = await user(1, 'ADMIN'), student = await user(2), otherStudent = await user(3);
    const course = await prisma.course.create({ data: { title: `Certificate ${key}`, slug: `certificate-${key}`, isPublished: true } }); courseIds.push(course.id);
    const session = await prisma.trainingSession.create({ data: { name: 'Session terminée', courseId: course.id, startDate: new Date('2025-01-01'), endDate: new Date('2025-03-01'), registrationDeadline: new Date('2024-12-01'), capacity: 10, status: 'COMPLETED' } });
    const enrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: session.id, status: 'CONFIRMED' } });
    const otherEnrollment = await prisma.enrollment.create({ data: { userId: otherStudent.id, trainingSessionId: session.id, status: 'CONFIRMED' } });

    await t.test('applique général puis formation puis session avec la bonne devise', async () => {
      await service.updateGeneralConfig({ certificatesPaid: 'on', generalAmount: '25', currency: 'USD' });
      assert.equal(Number((await service.applicableFee(enrollment.id)).amount), 25);
      await service.updateCourseFee(course.id, '18');
      assert.deepEqual({ amount: Number((await service.applicableFee(enrollment.id)).amount), source: (await service.applicableFee(enrollment.id)).source }, { amount: 18, source: 'COURSE' });
      await service.updateSessionFee(session.id, '12.50');
      const fee = await service.applicableFee(enrollment.id);
      assert.equal(Number(fee.amount), 12.5); assert.equal(fee.source, 'SESSION'); assert.equal(fee.currency, 'USD');
    });
    await t.test('ne génère rien automatiquement et distingue l’éligibilité du paiement', async () => {
      const snapshot = await service.state(enrollment.id);
      assert.equal(snapshot.eligibility.valid, true); assert.equal(snapshot.status, 'ELIGIBLE_PAYMENT_REQUIRED');
      assert.equal(await prisma.certificate.count({ where: { certificateRequest: { enrollmentId: enrollment.id } } }), 0);
    });
    await t.test('ne confond pas paiement de formation et paiement du certificat', async () => {
      await prisma.payment.create({ data: { reference: `COURSE-${key}`, provider: 'TEST', amount: 100, baseAmount: 100, registrationFee: 0, currency: 'USD', pricingMode: 'ONE_TIME', status: 'SUCCESS', enrollmentId: enrollment.id, courseId: course.id } });
      await assert.rejects(() => service.issue(enrollment.id, admin.id), error => error.code === 'PAYMENT_REQUIRED');
    });
    await t.test('recalcule le montant serveur et confirme le paiement une seule fois', async () => {
      const payment = await service.confirmPayment(enrollment.id, admin.id, { amount: '0.01', currency: 'EUR', paymentMethod: 'Espèces' });
      assert.equal(Number(payment.amount), 12.5); assert.equal(payment.currency, 'USD');
      const repeated = await service.confirmPayment(enrollment.id, admin.id, { paymentMethod: 'Autre' });
      assert.equal(repeated.id, payment.id);
      assert.equal(await prisma.certificatePayment.count({ where: { enrollmentId: enrollment.id, status: 'CONFIRMED' } }), 1);
    });
    await t.test('émet uniquement après le clic administrateur et refuse le doublon', async () => {
      const certificate = await service.issue(enrollment.id, admin.id);
      assert.equal(certificate.status, 'ISSUED');
      await assert.rejects(() => service.issue(enrollment.id, admin.id), error => error.code === 'ALREADY_ISSUED');
    });
    await t.test('exige un motif pour l’exonération et isole les étudiants', async () => {
      await assert.rejects(() => service.waiveFee(otherEnrollment.id, admin.id, ''), error => error.code === 'WAIVER_REASON_REQUIRED');
      const waiver = await service.waiveFee(otherEnrollment.id, admin.id, 'Bourse institutionnelle');
      assert.equal(waiver.isFeeWaived, true); assert.equal(waiver.feeWaivedByAdminId, admin.id);
      assert.equal(await prisma.certificatePayment.count({ where: { enrollmentId: otherEnrollment.id } }), 0);
      assert.equal((await service.state(enrollment.id)).request.isFeeWaived, false);
    });
    await t.test('émet gratuitement lorsque le montant applicable vaut zéro', async () => {
      const freeCourse = await prisma.course.create({ data: { title: `Free ${key}`, slug: `free-certificate-${key}`, certificateFee: 0 } }); courseIds.push(freeCourse.id);
      const freeSession = await prisma.trainingSession.create({ data: { name: 'Session gratuite', courseId: freeCourse.id, startDate: new Date('2025-01-01'), endDate: new Date('2025-02-01'), registrationDeadline: new Date('2024-12-01'), capacity: 5, status: 'COMPLETED' } });
      const freeEnrollment = await prisma.enrollment.create({ data: { userId: student.id, trainingSessionId: freeSession.id, status: 'CONFIRMED' } });
      assert.equal((await service.state(freeEnrollment.id)).status, 'ELIGIBLE_PAYMENT_CONFIRMED');
      assert.equal((await service.issue(freeEnrollment.id, admin.id)).status, 'ISSUED');
    });
    await t.test('révoque sans supprimer l’historique', async () => {
      const certificate = await prisma.certificate.findFirst({ where: { certificateRequest: { enrollmentId: enrollment.id } } });
      await service.revoke(certificate.id, admin.id, 'Correction administrative');
      const stored = await prisma.certificate.findUnique({ where: { id: certificate.id } });
      assert.equal(stored.status, 'REVOKED'); assert.ok(stored.issuedAt); assert.ok(stored.revokedAt);
    });
  } finally {
    await prisma.certificate.deleteMany({ where: { certificateRequest: { enrollment: { userId: { in: userIds } } } } });
    await prisma.payment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.certificateSettings.update({ where: { id: 1 }, data: { certificatesPaid: originalSettings.certificatesPaid, generalAmount: originalSettings.generalAmount, currency: originalSettings.currency } });
  }
});
