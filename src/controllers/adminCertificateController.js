const prisma = require('../utils/prisma');
const service = require('../services/certificateService');
const pdf = require('../services/certificatePdfService');
async function index(req, res) {
  const [rows, settings, courses, sessions] = await Promise.all([
    service.listForAdmin(), service.settings(),
    prisma.course.findMany({ select: { id: true, title: true, certificateFee: true }, orderBy: { title: 'asc' } }),
    prisma.trainingSession.findMany({ select: { id: true, name: true, certificateFee: true, course: { select: { title: true } } }, orderBy: { startDate: 'desc' } }),
  ]);
  res.render('admin/certificates/index', { title: 'Certificats', rows, settings, courses, sessions, success: req.query.success || '' });
}
async function config(req, res) { await service.updateGeneralConfig(req.body); res.redirect('/admin/certificates?success=config'); }
async function courseFee(req, res) { await service.updateCourseFee(req.params.id, req.body.certificateFee); res.redirect('/admin/certificates?success=course'); }
async function sessionFee(req, res) { await service.updateSessionFee(req.params.id, req.body.certificateFee); res.redirect('/admin/certificates?success=session'); }
async function payment(req, res) { await service.confirmPayment(req.params.enrollmentId, req.session.user.id, req.body); res.redirect('/admin/certificates?success=payment'); }
async function waive(req, res) { await service.waiveFee(req.params.enrollmentId, req.session.user.id, req.body.reason); res.redirect('/admin/certificates?success=waived'); }
async function issue(req, res) { await service.issue(req.params.enrollmentId, req.session.user.id); res.redirect('/admin/certificates?success=issued'); }
async function revoke(req, res) { await service.revoke(req.params.id, req.session.user.id, req.body.reason); res.redirect('/admin/certificates?success=revoked'); }
async function download(req, res) {
  const certificate = await service.getForAdmin(req.params.id);
  const buffer = await pdf.generate(certificate, { revokedWatermark: certificate.status === 'REVOKED' });
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${pdf.fileName(certificate)}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}
module.exports = { index, config, courseFee, sessionFee, payment, waive, issue, revoke, download };
