const prisma = require('../utils/prisma');
const service = require('../services/certificateService');
async function index(req, res) { res.render('student/certificates/index', { title: 'Mes certificats', rows: await service.listForStudent(req.student.id) }); }
async function show(req, res) {
  const certificate = await prisma.certificate.findFirst({ where: { id: service.parseId(req.params.id, 'certificat'), status: 'ISSUED', certificateRequest: { enrollment: { userId: req.student.id } } }, include: { certificateRequest: { include: { enrollment: { include: { user: true, trainingSession: { include: { course: true } } } } } } } });
  if (!certificate) { const error = new Error('Certificat introuvable.'); error.statusCode = 404; throw error; }
  res.render('student/certificates/show', { title: 'Certificat', certificate });
}
module.exports = { index, show };
