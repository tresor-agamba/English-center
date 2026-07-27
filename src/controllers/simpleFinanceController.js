const prisma = require('../utils/prisma');
const service = require('../services/simpleFinanceService');
const pdf = require('../services/paymentReceiptPdfService');

async function adminIndex(req, res) {
  const [fees, invoices, students, enrollments] = await Promise.all([
    prisma.feeConfiguration.findMany({ orderBy: [{ type: 'asc' }, { level: 'asc' }] }),
    prisma.studentInvoice.findMany({ include: { student: true, lines: true, payments: { include: { receipt: true } } }, orderBy: { issuedAt: 'desc' }, take: 100 }),
    prisma.user.findMany({ where: { role: 'STUDENT', isActive: true }, orderBy: { lastName: 'asc' }, take: 200 }),
    prisma.academicEnrollment.findMany({ where: { status: { in: ['ACTIVE', 'SUSPENDED', 'COMPLETED'] } }, include: { cohort: true, student: true }, take: 200 }),
  ]);
  res.render('admin/finances/index', { title: 'Finances', fees, invoices, students, enrollments, ...service });
}
async function configure(req, res) { await service.configureFee(req.body, req.session.user.id); res.redirect('/admin/finances'); }
async function invoice(req, res) { await service.createInvoice({ ...req.body, types: Array.isArray(req.body.types) ? req.body.types : [req.body.types] }, req.session.user.id); res.redirect('/admin/finances'); }
async function payment(req, res) { await service.recordPayment(req.params.invoiceId, req.body, req.session.user.id); res.redirect('/admin/finances'); }
async function studentIndex(req, res) {
  const data = await service.financialSituation(req.student.id);
  res.render('student/finances/index', { title: 'Ma situation financière', ...data });
}
async function receipt(req, res) {
  const requester = req.student ? { id: req.student.id, role: 'STUDENT' } : { id: req.session.user.id, role: req.session.user.role };
  const item = await service.receiptFor(req.params.id, requester);
  const buffer = await pdf.generate(item);
  res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${item.number}.pdf"`);
  res.send(buffer);
}
module.exports = { adminIndex, configure, invoice, payment, studentIndex, receipt };
