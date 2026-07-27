const service = require('../services/certificateService');
const pdf = require('../services/certificatePdfService');
async function index(req, res) { res.render('student/certificates/index', { title: 'Mes certificats', rows: await service.listForStudent(req.student.id) }); }
async function show(req, res) {
  const certificate = await service.getForStudent(req.params.id, req.student.id);
  res.render('student/certificates/show', { title: 'Certificat', certificate });
}
async function download(req, res) {
  const certificate = await service.getForStudent(req.params.id, req.student.id);
  const buffer = await pdf.generate(certificate);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${pdf.fileName(certificate)}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(buffer);
}
module.exports = { index, show, download };
