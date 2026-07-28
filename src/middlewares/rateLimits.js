const { rateLimit } = require('express-rate-limit');
const handler = (req, res) => res.status(429).render('errors/429', { title: 'Trop de requêtes', message: 'Veuillez patienter avant de réessayer.', requestId: req.requestId });
const make = (windowMs, limit) => rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler });
module.exports = {
  login: make(15 * 60 * 1000, 20), privateDownload: make(15 * 60 * 1000, 60),
  backupCreate: make(60 * 60 * 1000, 5), restore: make(24 * 60 * 60 * 1000, 2),
  exportCsv: make(15 * 60 * 1000, 30), payment: make(15 * 60 * 1000, 20),
  assessmentSubmit: make(15 * 60 * 1000, 30),
  passwordReset: make(60 * 60 * 1000, 10),
};
