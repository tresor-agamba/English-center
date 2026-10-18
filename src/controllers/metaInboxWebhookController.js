// Prepared ingress only: deliberately not imported by any live route.
// Authentication, account validation and durable atomic acceptance belong to
// the injected inbox service. No dispatcher, worker or sender runs here.
function createMetaInboxWebhookController({ inboxService, enabled = false, now = () => new Date() } = {}) {
  if (typeof inboxService?.acceptRaw !== 'function') throw new TypeError('Meta inbox service required.');
  return async function receive(req, res) {
    if (enabled !== true) return res.sendStatus(503);
    try {
      const receipt = await inboxService.acceptRaw({ rawBody: req.rawBody,
        signature: req.get('x-hub-signature-256'), receivedAt: now() });
      // Receipt acceptance is not an assertion that any business effect ran.
      return res.sendStatus(receipt?.accepted === true ? 200 : 503);
    } catch (error) {
      const status = { META_INBOX_INVALID_SIGNATURE: 403, META_INBOX_ACCOUNT_MISMATCH: 403,
        META_INBOX_INVALID_PAYLOAD: 400 }[error?.code] || 503;
      // Do not expose provider payloads, signatures, keys or storage errors.
      return res.sendStatus(status);
    }
  };
}
module.exports = { createMetaInboxWebhookController };
