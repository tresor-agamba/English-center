const service = require('../services/manualPaymentService');
const prisma = require('../utils/prisma');
const receiptPdf = require('../services/paymentReceiptPdfService');

function handle(res, error) {
  if (error instanceof service.ManualPaymentError) return res.status(error.statusCode).render('student/payment/error', { title: 'Paiement manuel', message: error.message });
  throw error;
}
async function pending(req, res) {
  const filters = req.query;
  const [payments, methods, courses] = await Promise.all([
    service.listRequests(filters), service.listMethods(),
    prisma.course.findMany({ where: { payments: { some: { provider: 'manual' } } }, select: { id: true, title: true }, orderBy: { title: 'asc' } }),
  ]);
  res.render('admin/payments/pending', { title: 'Paiements manuels', payments, methods, courses, filters, success: req.query.success || '' });
}
async function confirm(req, res) {
  try { await service.confirm(req.params.reference, req.session.user.id); return res.redirect('/admin/finances/manual-payments?success=confirmed'); }
  catch (error) { return handle(res, error); }
}
async function refuse(req, res) {
  try { await service.refuse(req.params.reference, req.session.user.id, req.body.reason); return res.redirect('/admin/finances/manual-payments?success=refused'); }
  catch (error) { return handle(res, error); }
}
async function methods(req, res) {
  const [methods, pendingCounts] = await Promise.all([service.listMethods(), service.pendingCountsByMethod()]);
  res.render('admin/payments/settings', { title: 'Moyens de paiement manuels', methods, pendingCounts, CURRENCIES: service.CURRENCIES, METHOD_TYPES: service.METHOD_TYPES, success: req.query.success || '', error: null });
}
async function createMethod(req, res) {
  try { await service.createMethod(req.body, req.session.user.id); return res.redirect('/admin/finances/payment-methods?success=created'); }
  catch (error) {
    if (!(error instanceof service.ManualPaymentError)) throw error;
    return res.status(error.statusCode).render('admin/payments/settings', { title: 'Moyens de paiement manuels', methods: await service.listMethods(), pendingCounts: await service.pendingCountsByMethod(), CURRENCIES: service.CURRENCIES, METHOD_TYPES: service.METHOD_TYPES, success: '', error: error.message });
  }
}
async function updateMethod(req, res) { try { await service.updateMethod(req.params.id, req.body, req.session.user.id); return res.redirect('/admin/finances/payment-methods?success=updated'); } catch (error) { return handle(res, error); } }
async function toggleMethod(req, res) { try { await service.toggleMethod(req.params.id, req.body.enabled, req.body.confirmation, req.session.user.id); return res.redirect('/admin/finances/payment-methods?success=toggled'); } catch (error) { return handle(res, error); } }
async function proof(req, res) {
  try { const item = await service.proof(req.params.reference, { id: req.session.user.id, role: 'ADMIN' }); return res.type(item.mimeType).setHeader('Cache-Control', 'private, no-store').sendFile(item.absolutePath); }
  catch (error) { return handle(res, error); }
}
async function receipt(req, res) { try { const payment = await service.receipt(req.params.reference, { id: req.session.user.id, role: 'ADMIN' }); const buffer = await receiptPdf.generateManual(payment); return res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${payment.metadata.receiptNumber}.pdf"`).send(buffer); } catch (error) { return handle(res, error); } }
module.exports = { pending, confirm, refuse, methods, createMethod, updateMethod, toggleMethod, proof, receipt };
