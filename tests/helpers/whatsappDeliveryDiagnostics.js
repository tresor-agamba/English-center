// Temporary, opt-in test instrumentation. No database imports or additional queries.
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const fixtures = new Map();
const aliases = new Map();
let sequence = 0;
let scenario = 'unlabelled';
const enabled = () => process.env.NODE_ENV === 'test'
  && process.env.NVA_WHATSAPP_DELIVERY_DIAGNOSTICS === '1';
const number = value => Number.isFinite(value) ? value : null;
const millis = value => value instanceof Date ? number(value.getTime()) : null;
const statuses = new Set(['QUEUED', 'PROCESSING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED']);
const states = new Set(['BOT_ACTIVE', 'HUMAN_TAKEOVER', 'BOT_PAUSED', 'OPTED_OUT', 'CLOSED']);
function snapshot(row) {
  return {
    present: Boolean(row),
    status: statuses.has(row?.deliveryStatus) ? row.deliveryStatus : null,
    direction: ['INBOUND', 'OUTBOUND'].includes(row?.direction) ? row.direction : null,
    attempts: number(row?.attempts), updatedAtMs: millis(row?.updatedAt),
    controlState: states.has(row?.conversation?.controlState) ? row.conversation.controlState : null,
  };
}
function rememberFixture(row) {
  if (enabled() && row) fixtures.set(row.id, snapshot(row));
}
function setScenario(name) { if (enabled()) scenario = name; }
function event(value) { context.getStore()?.events.push(value); }
function branch(result, events) {
  if (!result?.skipped) return null;
  const claim = events.find(e => e.kind === 'claim');
  if (!claim) return 'configuration_disabled';
  if (!claim.count) return 'claim_not_acquired';
  const reads = events.filter(e => e.kind === 'message_read');
  if (!reads[0]?.row.present || reads[0].row.status !== 'PROCESSING') return 'first_read_not_processing';
  if (!reads[1]?.row.present || reads[1].row.status !== 'PROCESSING'
    || reads[1].row.attempts !== reads[0].row.attempts) return 'second_read_changed';
  return 'unclassified';
}
function instrumentFactory(factory) {
  return function createDiagnosticService(options = {}) {
    if (!enabled()) return factory(options);
    const model = options.client.whatsAppConversationMessage;
    const observedModel = new Proxy(model, {
      get(target, key) {
        const original = Reflect.get(target, key);
        if (!['updateMany', 'findUnique', 'findFirst'].includes(key)) return original;
        return async args => {
          const value = await Reflect.apply(original, target, [args]);
          if (key === 'updateMany') event({
            kind: args.data?.deliveryStatus === 'PROCESSING' ? 'claim' : 'status_write',
            count: number(value.count),
            targetStatus: statuses.has(args.data?.deliveryStatus) ? args.data.deliveryStatus : null,
            cutoffMs: millis(args.where?.updatedAt?.lte),
            maxAttempts: number(args.where?.attempts?.lt),
          });
          if (key === 'findUnique' && args.include?.conversation) event({ kind: 'message_read', row: snapshot(value) });
          if (key === 'findFirst') event({ kind: 'window_read', inboundAtMs: millis(value?.providerTimestamp) });
          return value;
        };
      },
    });
    const observedClient = new Proxy(options.client, {
      get(target, key) { return key === 'whatsAppConversationMessage' ? observedModel : Reflect.get(target, key); },
    });
    const observedOptions = { ...options, client: observedClient };
    if (options.sender) observedOptions.sender = (...args) => {
      event({ kind: 'sender_called' });
      return Reflect.apply(options.sender, undefined, args);
    };
    const service = factory(observedOptions);
    return {
      ...service,
      sendMessage(id) {
        if (!aliases.has(id)) aliases.set(id, `fixture-${aliases.size + 1}`);
        const trace = { invocation: ++sequence, scenario, fixture: aliases.get(id),
          fixtureSnapshot: fixtures.get(id) || null, events: [] };
        return context.run(trace, async () => {
          let result;
          try { result = await service.sendMessage(id); return result; }
          finally {
            // Explicit scalar allowlist; no ids, phones, bodies, keys, URLs or errors.
            const outcome = Object.fromEntries(['skipped', 'accepted', 'failed', 'retryable', 'cancelled', 'statusRecordedByWebhook']
              .filter(key => typeof result?.[key] === 'boolean').map(key => [key, result[key]]));
            try {
              process.stderr.write(`[NVA_DELIVERY_DIAGNOSTIC] ${JSON.stringify({ ...trace,
                returned: Boolean(result), outcome, skippedBranch: branch(result, trace.events) })}\n`);
            } catch { /* Diagnostic output must never change the application's result/error. */ }
          }
        });
      },
    };
  };
}
module.exports = { enabled, setScenario, rememberFixture, instrumentFactory };
