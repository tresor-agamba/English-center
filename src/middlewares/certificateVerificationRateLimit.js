const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 30;

module.exports = function certificateVerificationRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).render('public/certificates/verify', {
      title: 'Vérifier un certificat', certificate: null,
      message: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.',
    });
  }
  return next();
};
