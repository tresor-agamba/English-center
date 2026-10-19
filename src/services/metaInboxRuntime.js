// Lazy incoming-only composition: no worker, sender or application DB import.
const { createMetaInboxCrypto, fail } = require('./metaInboxProtocol');
const { createMetaInboxRepository } = require('../repositories/metaInboxRepository');
const { createMetaInboxService } = require('./metaInboxService');
function createMetaInboxRuntime(env = process.env) {
  if (env.META_WHATSAPP_INBOX_ENABLED !== 'true' || env.META_INBOX_ENVIRONMENT !== 'test'
    || env.NODE_ENV === 'production') fail('META_INBOX_NOT_ACTIVATED');
  let url; try { url = new URL(env.META_INBOX_DATABASE_URL); } catch { fail('META_INBOX_INVALID_CONFIGURATION'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || url.port !== '55432' || url.pathname !== '/nva_whatsapp_test' || url.hash || url.search
    || decodeURIComponent(url.username) !== 'nva_meta_inbox_ingress' || !url.password) fail('META_INBOX_INVALID_CONFIGURATION');
  const key = value => {
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) fail('META_INBOX_INVALID_KEYS');
    return Buffer.from(value, 'hex');
  };
  const keys = value => {
    let parsed; try { parsed = JSON.parse(value); } catch { fail('META_INBOX_INVALID_KEYS'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('META_INBOX_INVALID_KEYS');
    return Object.fromEntries(Object.entries(parsed).map(([name, value]) => [name, key(value)]));
  };
  const scope = { endpointId: env.META_INBOX_ENDPOINT_ID, environment: env.META_INBOX_ENVIRONMENT,
    applicationKey: env.META_INBOX_APPLICATION_KEY, metaAppId: env.META_INBOX_APP_ID,
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID };
  const crypto = createMetaInboxCrypto({ lookupKeys: keys(env.META_INBOX_LOOKUP_KEYS_JSON),
    currentLookupVersion: env.META_INBOX_LOOKUP_KEY_VERSION, streamKey: key(env.META_INBOX_STREAM_KEY_HEX),
    streamKeyVersion: env.META_INBOX_STREAM_KEY_VERSION, encryptionKeys: keys(env.META_INBOX_ENCRYPTION_KEYS_JSON),
    currentEncryptionVersion: env.META_INBOX_ENCRYPTION_KEY_VERSION });
  // Validate scope and authentication before constructing any database client.
  let database;
  const repository = createMetaInboxRepository({ database: { $transaction: (...args) => database.$transaction(...args) }, scope, crypto });
  const service = createMetaInboxService({ repository, scope, authentication: {
    secret: env.WHATSAPP_APP_SECRET, version: env.META_INBOX_AUTH_KEY_VERSION }, mode: 'durable', activationEnabled: true });
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connection_limit', '4');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  const { PrismaClient } = require('@prisma/client');
  database = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  return Object.freeze({ acceptRaw: service.acceptRaw, close: () => database.$disconnect() });
}
module.exports = { createMetaInboxRuntime };
