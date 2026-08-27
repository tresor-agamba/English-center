const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TOKEN_BYTES = 32;
const MULTIPART_PATHS = [
  /^\/student\/oral-attempts\/\d+\/responses\/\d+\/audio$/,
  /^\/teacher\/written-assessments\/\d+\/questions\/\d+\/audio$/,
  /^\/admin\/written-assessments\/\d+\/questions\/\d+\/audio$/,
  /^\/admin\/lessons\/\d+\/resources\/private$/,
  /^\/admin\/settings\/files$/,
  /^\/payments\/[^/]+\/declare$/,
];

function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  return req.session.csrfToken;
}

function suppliedToken(req) {
  return req.body?._csrf || req.get('x-csrf-token') || '';
}

function tokensMatch(expected, supplied) {
  const expectedBuffer = Buffer.from(String(expected));
  const suppliedBuffer = Buffer.from(String(supplied));
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function error() {
  const failure = new Error('Votre session de formulaire a expiré. Rechargez la page puis réessayez.');
  failure.code = 'INVALID_CSRF_TOKEN';
  failure.statusCode = 403;
  return failure;
}

function verify(req, res, next) {
  const expected = ensureToken(req);
  if (process.env.NODE_ENV === 'test' && process.env.CSRF_ENFORCE !== 'true' && !suppliedToken(req)) return next();
  if (!tokensMatch(expected, suppliedToken(req))) return next(error());
  return next();
}

function protect(req, res, next) {
  if (req.path.startsWith('/webhooks/whatsapp')) return next();
  const token = ensureToken(req);
  res.locals.csrfToken = token;
  res.locals.csrfField = () => `<input type="hidden" name="_csrf" value="${token}">`;
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.is('multipart/form-data') && MULTIPART_PATHS.some(pattern => pattern.test(req.path))) return next();
  return verify(req, res, next);
}

module.exports = { protect, verify };
