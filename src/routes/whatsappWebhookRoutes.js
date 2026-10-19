const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { createMetaInboxWebhookController } = require('../controllers/metaInboxWebhookController');
const { createMetaInboxRuntime } = require('../services/metaInboxRuntime');
function createMetaWebhookRouter({ env = process.env, inboxService, now } = {}) {
  const router = express.Router(), enabled = env.META_WHATSAPP_INBOX_ENABLED === 'true';
  let runtime = inboxService;
  const receive = createMetaInboxWebhookController({ enabled, now, inboxService: { acceptRaw: input => {
    if (!runtime) runtime = createMetaInboxRuntime(env);
    return runtime.acceptRaw(input);
  } } });
  router.use((req, res, next) => enabled ? next() : res.sendStatus(503));
  router.get('/', (req, res) => {
    const token = env.WHATSAPP_VERIFY_TOKEN, supplied = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
    if (req.query['hub.mode'] !== 'subscribe' || typeof token !== 'string' || !token.trim()
      || typeof supplied !== 'string' || typeof challenge !== 'string' || !challenge || challenge.length > 512) return res.sendStatus(403);
    const a = Buffer.from(token), b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(403);
    return res.status(200).type('text/plain').send(challenge);
  });
  router.post('/', (req, res, next) => {
    if (!req.is('application/json') || !['identity', undefined].includes(req.get('content-encoding'))) return res.sendStatus(415);
    return next();
  }, express.raw({ type: 'application/json', limit: '1mb', inflate: false }), (req, res) => {
    if (!req.rawBody && Buffer.isBuffer(req.body)) req.rawBody = Buffer.from(req.body);
    return receive(req, res);
  });
  router.use((req, res) => res.sendStatus(404));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.sendStatus(error?.type === 'entity.too.large' ? 413 : 400);
  });
  return router;
}
module.exports = createMetaWebhookRouter();
module.exports.createMetaWebhookRouter = createMetaWebhookRouter;
