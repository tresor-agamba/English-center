const logger = require('../services/loggerService');
const sanitizeUrl = require('../utils/sanitizeUrl');
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const allowed = [400, 401, 403, 404, 409, 422, 429, 500, 503];
  const rawStatus = Number(error.statusCode || error.status || 500);
  const statusCode = allowed.includes(rawStatus) ? rawStatus : 500;
  // Parser errors may echo the untrusted request body in their message.
  const invalidBody = ['entity.parse.failed', 'entity.too.large', 'parameters.too.many'].includes(error.type);
  logger.error('HTTP_ERROR', { requestId: req.requestId, statusCode, route: sanitizeUrl(req.originalUrl?.split('?')[0] || ''), method: req.method, userId: req.session?.user?.id, ip: req.ip, error: invalidBody ? { code: 'INVALID_REQUEST_BODY' } : error });
  const message =
    statusCode >= 500
      ? 'Une erreur interne est survenue. Veuillez réessayer plus tard.'
      : invalidBody ? 'La demande est invalide. Veuillez réessayer.' : logger.sanitizeString(error.message || 'Une erreur est survenue.');

  if (req.accepts(['html', 'json']) === 'json') return res.status(statusCode).json({ error: message, requestId: req.requestId });
  const view = [403, 404, 429, 500, 503].includes(statusCode) ? `errors/${statusCode}` : 'error';
  return res.status(statusCode).render(view, {
    title: statusCode >= 500 ? 'Service indisponible' : 'Erreur', message, requestId: req.requestId,
    seo: { ...(res.locals?.seo || {}), pageTitle: `${statusCode >= 500 ? 'Service indisponible' : 'Erreur'} | New Vision Academy`, robotsMeta: 'noindex, nofollow' },
  });
}

module.exports = errorHandler;
