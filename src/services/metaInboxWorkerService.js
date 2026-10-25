// No singleton, dotenv, automatic start or default application DB connection.
const { randomUUID } = require('node:crypto');
const { readMetaInboxWorkerConfig } = require('../config/metaInboxWorkerConfig');
const { createMetaInboxRepository } = require('../repositories/metaInboxRepository');
const { createMetaInboxDispatcher } = require('./metaInboxDispatcher');
const { createMetaInboxPrismaAdapter } = require('./metaInboxPrismaAdapter');
const { fail } = require('./metaInboxProtocol');
const sourceId = key => typeof key === 'string' && /^wa-(?:reply|handoff):\S+:0$/.test(key) ? key.replace(/^wa-(?:reply|handoff):/, '').slice(0, -2) : null;
async function verifyWorkerIdentity(tx, config) {
  const [r] = await tx.$queryRaw`SELECT current_database() AS database,current_user AS role,
    host(inet_server_addr()) AS address,inet_server_port() AS port,r.rolcanlogin,r.rolsuper,
    r.rolcreatedb,r.rolcreaterole,r.rolreplication,r.rolbypassrls,r.rolinherit,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS memberships,
    has_database_privilege(current_user,current_database(),'CREATE,TEMP') AS database_create,
    has_schema_privilege(current_user,'public','CREATE') AS schema_create,
    EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='public'::regnamespace
      AND (c.relowner=r.oid OR (c.relkind IN ('r','p','v','m')
        AND has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER'))))
      OR has_column_privilege(r.oid,'public.whatsapp_conversation_messages','sender_user_id','INSERT,UPDATE')
      OR has_column_privilege(r.oid,'public."WhatsAppAdmissionRequest"','status','INSERT,UPDATE')
      OR has_any_column_privilege(r.oid,'public."WhatsAppAdmissionEvent"','INSERT,UPDATE')
      OR NOT has_function_privilege(r.oid,'public.nva_record_admission_consent(integer,text,jsonb)','EXECUTE') AS forbidden
    FROM pg_roles r WHERE r.rolname=current_user`;
  if (!r || r.database !== config.database || r.role !== config.role || r.address !== '127.0.0.1'
    || r.port !== config.port || r.rolcanlogin !== true
    || ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','rolinherit','memberships','database_create','schema_create','forbidden'].some(k => r[k] !== false)) fail('META_WORKER_DATABASE_IDENTITY_REJECTED');
}
function createMetaInboxWorker({ env = process.env, database, createDatabase = options => {
  const { PrismaClient } = require('@prisma/client'); return new PrismaClient(options);
}, sender, catalog, registration, now = () => new Date(), observe = () => {} } = {}) {
  const config = readMetaInboxWorkerConfig(env);
  const raw = database || createDatabase({ datasourceUrl: config.datasourceUrl, log: [] });
  const client = new Proxy(raw, { get(target, prop) {
    if (prop === '$transaction') return (work, options) => raw.$transaction(async tx => {
      await verifyWorkerIdentity(tx, config); return work(tx);
    }, options);
    const value = target[prop]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const repository = createMetaInboxRepository({ database: client, scope: config.scope, crypto: config.crypto });
  // Lazy imports: a disabled worker never imports application database modules.
  const conversation = require('./whatsappConversationService').createWhatsAppConversationService({ client, ...(catalog ? { catalog } : {}), ...(registration ? { registration } : {}), now });
  const dispatch = createMetaInboxDispatcher({ inboundTransaction: createMetaInboxPrismaAdapter({ endpointId: config.scope.endpointId, conversationService: conversation }) });
  const owner = 'meta-worker-' + randomUUID();
  let running = false, closing = false;
  const fixedKeys = ['NODE_ENV','NVA_V2_DATABASE_TESTS_ENABLED','NVA_V2_DATABASE_EXPECTED_DIRECTORY','META_INBOX_ENVIRONMENT','META_INBOX_DATABASE_URL','META_INBOX_WORKER_DATABASE_URL',
    'META_INBOX_ENDPOINT_ID','META_INBOX_APPLICATION_KEY','META_INBOX_APP_ID','WHATSAPP_BUSINESS_ACCOUNT_ID','WHATSAPP_PHONE_NUMBER_ID',
    'META_INBOX_LOOKUP_KEYS_JSON','META_INBOX_LOOKUP_KEY_VERSION','META_INBOX_STREAM_KEY_HEX','META_INBOX_STREAM_KEY_VERSION',
    'META_INBOX_ENCRYPTION_KEYS_JSON','META_INBOX_ENCRYPTION_KEY_VERSION','META_INBOX_SEND_NOT_BEFORE'];
  const fixed = fixedKeys.map(k => env[k]);
  const live = () => {
    if (fixedKeys.some((k, i) => env[k] !== fixed[i])) fail('META_WORKER_CONFIGURATION_CHANGED');
    return readMetaInboxWorkerConfig(env);
  };
  const emit = (action, summary) => { try { observe(action, summary); } catch { /* Observers never change delivery decisions. */ } };
  async function ready() {
    live();
    return client.$transaction(async tx => {
      const e = await tx.metaWebhookEndpoint.findFirst({ where: { id: config.scope.endpointId, environment: config.scope.environment,
        applicationKey: config.scope.applicationKey, metaAppId: config.scope.metaAppId, wabaId: config.scope.wabaId, phoneNumberId: config.scope.phoneNumberId } });
      if (!e || e.disabledAt || !e.inboxEnabled || !e.processingEnabled) fail('META_INBOX_PROCESSING_DISABLED');
      return true;
    }, { isolationLevel: 'Serializable', timeout: 5000 });
  }
  async function belongs(tx, row, cutoff) {
    if(require('./metaManualReplyScope').matches(row,config.scope.endpointId)){
      if(cutoff&&new Date(row.createdAt)<cutoff)return false;
      const conversation=await tx.whatsAppConversation.findUnique({where:{id:row.conversationId}});
      if(!conversation?.phoneNumber)return false;
      return Boolean(await tx.metaWebhookEvent.findFirst({where:{endpointId:config.scope.endpointId,streamKey:config.crypto.stream(config.scope.endpointId,conversation.phoneNumber.replace(/^\+/,'')),kind:'INBOUND',state:'PROCESSED',effectOutcome:'APPLIED'},select:{id:true}}));
    }
    const native = sourceId(row.idempotencyKey);
    if (!native || row.senderUserId || row.direction !== 'OUTBOUND') return false;
    const event = await tx.metaWebhookEvent.findFirst({ where: { endpointId: config.scope.endpointId, nativeMessageId: native,
      kind: 'INBOUND', state: 'PROCESSED', effectOutcome: 'APPLIED', ...(cutoff ? { firstReceivedAt: { gte: cutoff } } : {}) } });
    const conversation = await tx.whatsAppConversation.findUnique({ where: { id: row.conversationId } });
    return Boolean(event?.streamKey && conversation?.phoneNumber && Buffer.from(event.streamKey).equals(config.crypto.stream(config.scope.endpointId, conversation.phoneNumber.replace(/^\+/, ''))));
  }
  async function outgoing(summary) {
    if (!live().sendEnabled) return;
    const messages = client.whatsAppConversationMessage;
    // Only native replies and explicitly endpoint-scoped new manual replies.
    // Prisma stores these DateTime columns as UTC timestamp WITHOUT time zone.
    // Raw Date parameters are timestamptz: convert explicitly, never via session TZ.
    const oldIds = await client.$queryRaw`SELECT m.id AS outgoing_id FROM whatsapp_conversation_messages m
      JOIN meta_webhook_events e ON e.endpoint_id=${config.scope.endpointId}::uuid AND e.kind='INBOUND'
       AND e.state='PROCESSED' AND e.effect_outcome='APPLIED'
       AND m.idempotency_key IN ('wa-reply:'||e.native_message_id||':0','wa-handoff:'||e.native_message_id||':0')
      WHERE m.direction='OUTBOUND' AND m.delivery_status='PROCESSING' AND m.sender_user_id IS NULL
       AND m.updated_at < (${new Date(+now() - 15 * 60000)}::timestamptz AT TIME ZONE 'UTC') ORDER BY m.id LIMIT ${config.batchSize}`;
    const old = oldIds.length ? await messages.findMany({ where: { id: { in: oldIds.map(r => r.outgoing_id) } } }) : [];
    old.push(...await messages.findMany({where:{direction:'OUTBOUND',deliveryStatus:'PROCESSING',senderUserId:{not:null},idempotencyKey:{startsWith:require('./metaManualReplyScope').prefix(config.scope.endpointId)},updatedAt:{lt:new Date(+now()-15*60000)}},take:config.batchSize}));
    for (const row of old) if (await belongs(client, row)) {
      const changed = await messages.updateMany({ where: { id: row.id, deliveryStatus: 'PROCESSING', attempts: row.attempts, updatedAt: row.updatedAt },
        data: { deliveryStatus: 'FAILED', processingStartedAt: null, failureCode: 'DELIVERY_UNCERTAIN' } }); summary.uncertain += changed.count;
    }
    const ids = await client.$queryRaw`SELECT m.id AS outgoing_id FROM whatsapp_conversation_messages m
      JOIN meta_webhook_events e ON e.endpoint_id=${config.scope.endpointId}::uuid AND e.kind='INBOUND'
       AND e.state='PROCESSED' AND e.effect_outcome='APPLIED' AND e.first_received_at >= ${live().notBefore}
       AND m.idempotency_key IN ('wa-reply:'||e.native_message_id||':0','wa-handoff:'||e.native_message_id||':0')
      WHERE m.direction='OUTBOUND' AND m.delivery_status='QUEUED' AND m.sender_user_id IS NULL
       AND m.created_at >= (${live().notBefore}::timestamptz AT TIME ZONE 'UTC')
       AND m.updated_at <= (${now()}::timestamptz AT TIME ZONE 'UTC')
       AND m.attempts < ${config.cloudConfig.maxAttempts + 1}
      ORDER BY m.created_at,m.id LIMIT ${config.batchSize}`;
    const rows = ids.length ? await messages.findMany({ where: { id: { in: ids.map(r => r.outgoing_id) } } }) : [];
    rows.push(...await messages.findMany({where:{direction:'OUTBOUND',deliveryStatus:'QUEUED',senderUserId:{not:null},idempotencyKey:{startsWith:require('./metaManualReplyScope').prefix(config.scope.endpointId)},createdAt:{gte:live().notBefore},updatedAt:{lte:now()},attempts:{lt:config.cloudConfig.maxAttempts+1}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:config.batchSize}));
    for (const row of rows) {
      if (closing || !live().sendEnabled) break;
      if (!await belongs(client, row, live().notBefore)) continue;
      const delivery = require('./whatsappConversationDeliveryService').createWhatsAppConversationDeliveryService({ client, now,
        configProvider: () => live().cloudConfig,
        submissionBarrier: async (tx, phone) => live().sendEnabled && await belongs(tx, row, live().notBefore) && await repository.canSubmitIn(tx, phone),
        sender: async (data, options) => {
          if (!live().sendEnabled) fail('META_WORKER_SEND_DISABLED');
          return (sender || require('./whatsappCloudApiService').sendConversationMessage)(data, { ...options, config: live().cloudConfig });
        } });
      const result = await delivery.sendMessage(row.id);
      if (result.accepted) summary.accepted++;
      else if (result.cancelled) summary.cancelled++;
      else if (result.failed) summary.failed++;
    }
  }
  async function runOnce() {
    if (closing || running || env.META_INBOX_WORKER_ENABLED !== 'true') return { skipped: true };
    running = true;
    const summary = { processed: 0, retrying: 0, accepted: 0, cancelled: 0, failed: 0, uncertain: 0 };
    try {
      live(); await ready();
      for (let i = 0; i < config.batchSize && !closing && env.META_INBOX_WORKER_ENABLED === 'true'; i++) {
        live(); const lease = await repository.claim({ owner }); if (!lease) break;
        const result = await repository.process(lease, dispatch);
        if (result.state === 'RETRY_WAIT') summary.retrying++;
        else if (result.state === 'FAILED') summary.failed++;
        else summary.processed++;
      }
      if (!closing && env.META_INBOX_WORKER_ENABLED === 'true') await outgoing(summary);
      emit('META_WORKER_BATCH', summary); return summary;
    } catch (error) {
      const code = /^META_(?:INBOX|WORKER)_[A-Z_]+$/.test(error?.code || '') ? error.code : 'META_WORKER_BATCH_FAILED';
      emit('META_WORKER_ERROR', { code }); throw Object.assign(new Error('Meta worker batch failed.'), { code });
    } finally { running = false; }
  }
  function requestStop() { closing = true; }
  async function close() {
    requestStop();
    // Do not disconnect during a transaction or an in-flight Meta request.
    while (running) await new Promise(resolve => setTimeout(resolve, 25));
    await raw.$disconnect();
  }
  return { runOnce, ready, requestStop, close, intervalMs: config.intervalMs };
}
module.exports = { createMetaInboxWorker, verifyWorkerIdentity, sourceId };
