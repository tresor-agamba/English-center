// Incoming-only acceptance; processing remains a separate transaction concern.
const { createHmac, timingSafeEqual } = require('node:crypto');
const { normalizeMetaBatch, fail } = require('./metaInboxProtocol');
function createMetaInboxService({ repository, scope, authentication, mode, activationEnabled = false,
  nodeEnvironment = process.env.NODE_ENV, productionAuthorized = false } = {}) {
  if (!repository?.accept || !scope?.wabaId || !scope.phoneNumberId || repository.scope?.wabaId !== scope.wabaId
    || repository.scope.phoneNumberId !== scope.phoneNumberId || typeof authentication?.secret !== 'string'
    || !authentication.secret.trim() || !/^[a-zA-Z0-9_-]{1,64}$/.test(authentication.version || '')) fail('META_INBOX_INVALID_CONFIGURATION');
  const secret = authentication.secret, authenticationKeyVersion = authentication.version;
  const account = Object.freeze({ wabaId: scope.wabaId, phoneNumberId: scope.phoneNumberId });
  async function acceptRaw({ rawBody, signature, receivedAt }) {
    const isolated = mode === 'isolated' && nodeEnvironment === 'test' && process.env.NODE_ENV === 'test'
      && repository.scope.environment === 'test';
    const production = repository.scope.environment === 'production' && nodeEnvironment === 'production'
      && productionAuthorized === true;
    const durable = mode === 'durable' && activationEnabled === true && (production
      || repository.scope.environment === 'test' && nodeEnvironment !== 'production' && process.env.NODE_ENV !== 'production');
    if (!isolated && !durable) fail('META_INBOX_NOT_ACTIVATED');
    if (!Buffer.isBuffer(rawBody) || !rawBody.length || rawBody.length > 1024 * 1024) fail('META_INBOX_INVALID_PAYLOAD');
    const bytes = Buffer.from(rawBody); // Caller mutation cannot change authenticated bytes.
    if (typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) fail('META_INBOX_INVALID_SIGNATURE');
    const expected = createHmac('sha256', secret).update(bytes).digest(), supplied = Buffer.from(signature.slice(7), 'hex');
    if (!timingSafeEqual(expected, supplied)) fail('META_INBOX_INVALID_SIGNATURE');
    let payload;
    try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('META_INBOX_INVALID_PAYLOAD'); }
    const items = normalizeMetaBatch(payload, { ...account, receivedAt });
    return repository.accept({ rawBody: bytes, items, receivedAt: new Date(receivedAt), authenticationKeyVersion });
  }
  return Object.freeze({ acceptRaw });
}
module.exports = { createMetaInboxService };
