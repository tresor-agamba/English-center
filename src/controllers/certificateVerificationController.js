const service = require('../services/certificateService');

function noStore(res) {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.set('X-Content-Type-Options', 'nosniff');
}
async function renderResult(req, res, value) {
  noStore(res);
  const certificate = await service.findPublicCertificate(value);
  return res.status(certificate ? 200 : 404).render('public/certificates/verify', {
    title: 'Vérifier un certificat',
    certificate,
    message: certificate ? '' : 'Aucun certificat valide ne correspond à ces informations.',
  });
}
function form(req, res) {
  noStore(res);
  res.render('public/certificates/verify', { title: 'Vérifier un certificat', certificate: null, message: '' });
}
async function byCode(req, res) { return renderResult(req, res, req.params.verificationCode); }
async function search(req, res) { return renderResult(req, res, req.body.query); }

module.exports = { form, byCode, search };
