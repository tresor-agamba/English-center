// Separate opt-in worker; the receive-only runtime and legacy flags stay intact.
const { validateMetaInboxTarget } = require('../services/metaInboxRuntime');
const { createMetaInboxCrypto, fail } = require('../services/metaInboxProtocol');
function readMetaInboxWorkerConfig(env = process.env) {
  if (env.META_INBOX_WORKER_ENABLED !== 'true') fail('META_WORKER_DISABLED');
  const base = validateMetaInboxTarget(env);
  if (base.production && env.META_INBOX_WORKER_PRODUCTION_AUTHORIZED !== 'true') fail('META_WORKER_NOT_AUTHORIZED');
  // Never coexist with a second sender, even outside production.
  if (['WHATSAPP_ENABLED', 'WHATSAPP_WORKERS_ENABLED'].some(k => String(env[k] || '').trim().toLowerCase() === 'true')) fail('META_WORKER_LEGACY_CONFLICT');
  const role = base.production ? 'nva_meta_inbox_worker_prod' : base.target.workerRole||'nva_meta_inbox_worker';
  let url; try { url = new URL(env.META_INBOX_WORKER_DATABASE_URL); } catch { fail('META_WORKER_INVALID_DATABASE'); }
  try {
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== base.url.hostname
      || url.port !== base.target.port || url.pathname !== '/' + base.target.database || url.search || url.hash
      || decodeURIComponent(url.username) !== role || !decodeURIComponent(url.password)) fail('META_WORKER_INVALID_DATABASE');
  } catch { fail('META_WORKER_INVALID_DATABASE'); }
  const sendEnabled = env.META_INBOX_SEND_ENABLED === 'true';
  if (sendEnabled && base.production && env.META_INBOX_SEND_PRODUCTION_AUTHORIZED !== 'true') fail('META_WORKER_SEND_NOT_AUTHORIZED');
  let notBefore = new Date(0);
  if (sendEnabled) {
    if (typeof env.META_INBOX_SEND_NOT_BEFORE !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(env.META_INBOX_SEND_NOT_BEFORE)) fail('META_WORKER_INVALID_CUTOFF');
    notBefore = new Date(env.META_INBOX_SEND_NOT_BEFORE);
    if (!Number.isFinite(+notBefore)) fail('META_WORKER_INVALID_CUTOFF');
  }
  const integer = (key, fallback, min, max) => {
    if (env[key] === undefined || env[key] === '') return fallback;
    const n = Number(env[key]); if (!Number.isInteger(n) || n < min || n > max) fail('META_WORKER_INVALID_LIMIT'); return n;
  };
  const key = value => { if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) fail('META_INBOX_INVALID_KEYS'); return Buffer.from(value, 'hex'); };
  const keys = value => {
    let v; try { v = JSON.parse(value); } catch { fail('META_INBOX_INVALID_KEYS'); }
    if (!v || Array.isArray(v) || typeof v !== 'object') fail('META_INBOX_INVALID_KEYS');
    return Object.fromEntries(Object.entries(v).map(([name, value]) => [name, key(value)]));
  };
  const crypto = createMetaInboxCrypto({ lookupKeys: keys(env.META_INBOX_LOOKUP_KEYS_JSON), currentLookupVersion: env.META_INBOX_LOOKUP_KEY_VERSION,
    streamKey: key(env.META_INBOX_STREAM_KEY_HEX), streamKeyVersion: env.META_INBOX_STREAM_KEY_VERSION,
    encryptionKeys: keys(env.META_INBOX_ENCRYPTION_KEYS_JSON), currentEncryptionVersion: env.META_INBOX_ENCRYPTION_KEY_VERSION });
  const scope = { endpointId: env.META_INBOX_ENDPOINT_ID, environment: env.META_INBOX_ENVIRONMENT,
    applicationKey: env.META_INBOX_APPLICATION_KEY, metaAppId: env.META_INBOX_APP_ID,
    wabaId: env.WHATSAPP_BUSINESS_ACCOUNT_ID, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID };
  const cloudConfig = { ...require('./whatsappConfig').getWhatsAppConfig(env), enabled: sendEnabled, workersEnabled: false };
  if (sendEnabled && (cloudConfig.fakeMode || !/^v\d+\.\d+$/.test(cloudConfig.graphApiVersion)
    || !/^[1-9]\d{0,63}$/.test(cloudConfig.phoneNumberId) || !cloudConfig.accessToken || /[\r\n]/.test(cloudConfig.accessToken))) fail('META_WORKER_INVALID_TRANSPORT');
  url.searchParams.set('schema', 'public'); url.searchParams.set('connection_limit', '4');
  url.searchParams.set('connect_timeout', '5'); url.searchParams.set('pool_timeout', '5');
  url.searchParams.set('socket_timeout', '15');
  return { scope, crypto, datasourceUrl: url.toString(), role, production: base.production,
    database: base.target.database, port: Number(base.target.port), sendEnabled, notBefore, cloudConfig,
    batchSize: integer('META_INBOX_WORKER_BATCH_SIZE', 20, 1, 50), intervalMs: integer('META_INBOX_WORKER_POLL_MS', 2000, 1000, 60000) };
}
module.exports = { readMetaInboxWorkerConfig };
