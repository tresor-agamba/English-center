// Simulation-only inbox/alias interface. Volatile memory is NOT durable storage.
const { canonicalId } = require('./gupshupTransport');
function error(code) { return Object.assign(new Error('Simulated Gupshup correlation refused.'), { code }); }
function createGupshupMemoryCorrelation({ mode } = {}) {
  if (mode !== 'simulation' || process.env.NODE_ENV === 'production') throw error('GUPSHUP_SIMULATION_REQUIRED');
  const events = new Map(), aliases = new Map(), bindings = new Map();
  const key = (app, type, value) => JSON.stringify([app, type, value]);
  const copy = value => structuredClone(value);
  function resolve(event) {
    const found = Object.entries(event.externalIds).map(([type, value]) => aliases.get(key(event.applicationKey, type, value))).filter(Boolean);
    if (new Set(found).size > 1) throw error('GUPSHUP_ALIAS_CONFLICT');
    const binding = found.length ? bindings.get(found[0]) : null;
    if (binding && event.externalIds.gupshup && event.externalIds.gupshup !== binding.submissionId) throw error('GUPSHUP_ALIAS_CONFLICT');
    return binding;
  }
  function bind({ applicationKey, submissionId, whatsappId, deliveryKind, deliveryId, attemptNumber, ready = false }) {
    const canonical = canonicalId(applicationKey, submissionId);
    if (!['conversation', 'notification', 'followUp'].includes(deliveryKind) || !Number.isSafeInteger(deliveryId) || deliveryId < 1
      || !Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || typeof ready !== 'boolean') throw error('GUPSHUP_INVALID_BINDING');
    if (whatsappId !== undefined && (typeof whatsappId !== 'string' || !whatsappId.trim() || whatsappId.length > 512)) throw error('GUPSHUP_INVALID_BINDING');
    const old = bindings.get(canonical);
    if (old && (old.deliveryId !== deliveryId || old.deliveryKind !== deliveryKind || old.attemptNumber !== attemptNumber)) throw error('GUPSHUP_ALIAS_CONFLICT');
    const entries = [['gupshup', submissionId], ...(whatsappId ? [['whatsapp', whatsappId]] : [])];
    for (const [type, value] of entries) if (aliases.has(key(applicationKey, type, value)) && aliases.get(key(applicationKey, type, value)) !== canonical) throw error('GUPSHUP_ALIAS_CONFLICT');
    const binding = { applicationKey, submissionId, providerMessageId: canonical, deliveryKind, deliveryId, attemptNumber, ready: Boolean(old?.ready || ready) };
    bindings.set(canonical, binding);
    for (const [type, value] of entries) aliases.set(key(applicationKey, type, value), canonical);
    return copy(binding);
  }
  function receive(event) {
    if (!event || event.provider !== 'gupshup' || !/^[a-f0-9]{64}$/.test(event.deduplicationKey || '')
      || !event.applicationKey || !event.externalIds || !['status', 'transport', 'inbound', 'unsupported'].includes(event.kind)) throw error('GUPSHUP_INVALID_EVENT');
    const id = key(event.applicationKey, 'event', event.deduplicationKey);
    if (!events.has(id)) events.set(id, { event: copy(event), state: 'PENDING' });
    return id;
  }
  async function processEvent(id, { applyStatus } = {}) {
    const entry = events.get(id);
    if (!entry) throw error('GUPSHUP_UNKNOWN_EVENT');
    if (entry.state === 'DONE' || entry.state === 'PROCESSING') return entry.state;
    if (!['status', 'transport'].includes(entry.event.kind)) { entry.state = 'RETAINED'; return entry.state; }
    const binding = resolve(entry.event);
    if (!binding) { entry.state = 'WAITING_CORRELATION'; return entry.state; }
    // Learn the WhatsApp alias only after an unambiguous known submission is resolved.
    if (entry.event.externalIds.whatsapp) bind({ ...binding, whatsappId: entry.event.externalIds.whatsapp });
    if (entry.event.kind === 'transport') {
      bind({ ...binding, submissionId: entry.event.externalIds.gupshup,
        whatsappId: entry.event.externalIds.whatsapp });
      entry.state = 'DONE'; return entry.state;
    }
    if (!binding.ready) { entry.state = 'WAITING_BINDING'; return entry.state; }
    if (typeof applyStatus !== 'function') throw error('GUPSHUP_STATUS_HANDLER_REQUIRED');
    entry.state = 'PROCESSING';
    try {
      // Caller must use deliveryKind/id/attempt to route to the exact local delivery.
      const handled = await applyStatus({ ...copy(entry.event.data), id: binding.providerMessageId }, copy(binding));
      entry.state = handled === true ? 'DONE' : 'WAITING_BINDING';
      return entry.state;
    } catch (e) { entry.state = 'PENDING'; throw e; }
  }
  return Object.freeze({ bind, receive, process: processEvent, inspect: id => copy(events.get(id) || null) });
}
module.exports = { createGupshupMemoryCorrelation };
