const logger = require('../services/loggerService');
module.exports = (req, res, next) => {
  req.requestId = logger.requestId();
  res.setHeader('X-Request-Id', req.requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => logger.info('HTTP_REQUEST', {
    requestId: req.requestId, userId: req.session?.user?.id, route: req.originalUrl.split('?')[0],
    method: req.method, status: res.statusCode, durationMs: Number(process.hrtime.bigint() - started) / 1e6, ip: req.ip,
  }));
  next();
};
