// Lazy incoming-only composition: no worker, sender or application DB import.
const { createMetaInboxCrypto, fail } = require('./metaInboxProtocol');
const { createMetaInboxRepository } = require('../repositories/metaInboxRepository');
const { createMetaInboxService } = require('./metaInboxService');
function validateMetaInboxTarget(env) {
  const production = env.META_INBOX_ENVIRONMENT === 'production';
  if (env.META_WHATSAPP_INBOX_ENABLED !== 'true'
    || (production ? env.NODE_ENV !== 'production' || env.META_INBOX_PRODUCTION_AUTHORIZED !== 'true'
      : env.META_INBOX_ENVIRONMENT !== 'test' || env.NODE_ENV === 'production')) fail('META_INBOX_NOT_ACTIVATED');
  if (production && ['WHATSAPP_ENABLED', 'WHATSAPP_WORKERS_ENABLED'].some(k =>
    String(env[k] || '').trim().toLowerCase() === 'true')) fail('META_INBOX_OUTBOUND_MUST_BE_DISABLED');
  const target = production ? { port: '5432', database: 'english_center', role: 'nva_meta_inbox_ingress_prod' }
    : { port: '55432', database: 'nva_whatsapp_test', role: 'nva_meta_inbox_ingress' };
  let url; try { url = new URL(env.META_INBOX_DATABASE_URL); } catch { fail('META_INBOX_INVALID_CONFIGURATION'); }
  let role; try { role = decodeURIComponent(url.username); decodeURIComponent(url.password); } catch { fail('META_INBOX_INVALID_CONFIGURATION'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
    || url.port !== target.port || url.pathname !== '/' + target.database || url.hash || url.search
    || role !== target.role || !url.password) fail('META_INBOX_INVALID_CONFIGURATION');
  return { url, production, target };
}
function createMetaInboxRuntime(env = process.env, { createDatabase = options => {
  const { PrismaClient } = require('@prisma/client'); return new PrismaClient(options);
} } = {}) {
  const { url, production, target } = validateMetaInboxTarget(env);
  if (production && (['WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_BUSINESS_ACCOUNT_ID','META_INBOX_APP_ID']
    .some(k => !/^[1-9]\d{0,63}$/.test(env[k] || ''))
    || typeof env.WHATSAPP_APP_SECRET !== 'string' || env.WHATSAPP_APP_SECRET.trim().length < 32
    || typeof env.WHATSAPP_VERIFY_TOKEN !== 'string' || env.WHATSAPP_VERIFY_TOKEN.trim().length < 32)) fail('META_INBOX_INVALID_CONFIGURATION');
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
  const verifiedDatabase = { $transaction: (work, options) => database.$transaction(async tx => {
    if (production) await verifyProductionIdentity(tx, target);
    return work(tx);
  }, options) };
  const repository = createMetaInboxRepository({ database: verifiedDatabase, scope, crypto });
  const service = createMetaInboxService({ repository, scope, authentication: {
    secret: env.WHATSAPP_APP_SECRET, version: env.META_INBOX_AUTH_KEY_VERSION }, mode: 'durable', activationEnabled: true,
    nodeEnvironment: env.NODE_ENV, productionAuthorized: production && env.META_INBOX_PRODUCTION_AUTHORIZED === 'true' });
  url.searchParams.set('schema', 'public');
  url.searchParams.set('connection_limit', '4');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  database = createDatabase({ datasourceUrl: url.toString(), log: [] });
  return Object.freeze({ acceptRaw: service.acceptRaw,
    ready: () => verifiedDatabase.$transaction(async () => true, { isolationLevel: 'Serializable', timeout: 5000 }),
    close: () => database.$disconnect() });
}
async function verifyProductionIdentity(tx, target) {
  const [row] = await tx.$queryRaw`SELECT current_database() AS database, current_user AS role,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS database_create,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create
    FROM pg_roles r WHERE r.rolname=current_user`;
  if (!row || row.database !== target.database || row.role !== target.role || row.address !== '127.0.0.1'
    || row.port !== Number(target.port) || row.rolcanlogin !== true
    || ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','rolinherit','memberships','database_create','schema_create']
      .some(k => row[k] !== false)) fail('META_INBOX_DATABASE_IDENTITY_REJECTED');
  const [acl] = await tx.$queryRaw`SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') AND (
      c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      OR CASE WHEN c.relkind='S' THEN
        CASE WHEN c.relname='meta_webhook_events_enqueue_order_seq'
          THEN has_sequence_privilege(current_user,c.oid,'SELECT,UPDATE')
          ELSE has_sequence_privilege(current_user,c.oid,'USAGE,SELECT,UPDATE') END
      WHEN c.relname IN ('meta_webhook_endpoints','meta_webhook_receipts','meta_webhook_events','meta_webhook_receipt_items')
        THEN has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(current_user,c.oid,'REFERENCES')
      ELSE has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END
    )
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute at JOIN pg_class c ON c.oid=at.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND at.attnum>0 AND NOT at.attisdropped
      AND c.relname IN ('meta_webhook_endpoints','meta_webhook_receipts','meta_webhook_events','meta_webhook_receipt_items')
      AND ((c.relname='meta_webhook_endpoints' AND has_column_privilege(current_user,c.oid,at.attnum,'INSERT'))
        OR (has_column_privilege(current_user,c.oid,at.attnum,'UPDATE') AND NOT (
          c.relname='meta_webhook_endpoints' AND at.attname='id'
          OR c.relname='meta_webhook_receipts' AND at.attname IN ('item_count','new_count','duplicate_count','conflict_count')
          OR c.relname='meta_webhook_events' AND at.attname IN ('receipt_count','last_received_at','has_conflict','review_required',
            'state','failed_at','reason_code','next_attempt_at','lease_token','lease_owner','lease_expires_at')
        )))
  ) OR EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
      acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) a
    WHERE a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user)) AND a.is_grantable
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute at CROSS JOIN LATERAL aclexplode(at.attacl) a
    WHERE a.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname=current_user)) AND a.is_grantable
  ) AS forbidden`;
  if (!acl || acl.forbidden !== false) fail('META_INBOX_DATABASE_PRIVILEGES_REJECTED');
}
module.exports = { createMetaInboxRuntime, validateMetaInboxTarget };
