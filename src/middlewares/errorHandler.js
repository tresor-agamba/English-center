const logger = require('../services/loggerService');
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const allowed = [400, 401, 403, 404, 409, 422, 429, 500, 503];
  const rawStatus = Number(error.statusCode || error.status || 500);
  const statusCode = allowed.includes(rawStatus) ? rawStatus : 500;
  logger.error('HTTP_ERROR', { requestId: req.requestId, statusCode, route: req.originalUrl?.split('?')[0], method: req.method, userId: req.session?.user?.id, ip: req.ip, error });
  const message =
    statusCode >= 500
      ? 'Une erreur interne est survenue. Veuillez réessayer plus tard.'
      : error.message || 'Une erreur est survenue.';

  if (req.accepts(['html', 'json']) === 'json') return res.status(statusCode).json({ error: message, requestId: req.requestId });
  const view = [403, 404, 429, 500, 503].includes(statusCode) ? `errors/${statusCode}` : 'error';
  return res.status(statusCode).render(view, { title: statusCode >= 500 ? 'Service indisponible' : 'Erreur', message, requestId: req.requestId });
}

module.exports = errorHandler;
