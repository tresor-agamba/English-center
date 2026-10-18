// Shared delivery policy. Callback correlation is not provider-side deduplication.
const UNCERTAIN = 'DELIVERY_UNCERTAIN';
const STATUS_RANK = { ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4 };
const STATUS_MAP = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
function classifySendError(error) {
  // Unknown exceptions (including persistence after an HTTP success) are unsafe.
  const uncertain = error?.uncertain === true || error?.code === UNCERTAIN
    || (error?.retryable === true && error?.acceptanceRejected !== true)
    || (error?.retryable !== true && error?.retryable !== false);
  const retryable = !uncertain && error?.retryable === true && error?.acceptanceRejected === true;
  return { uncertain, retryable, failureCode: uncertain ? UNCERTAIN : String(error?.code || 'SEND_ERROR').slice(0, 100) };
}
function retryDelay(attempts) { return [60_000, 300_000, 1_800_000][Math.min(Math.max(attempts - 1, 0), 2)]; }
function callbackDate(timestamp, fallback) {
  const at = /^\d+$/.test(String(timestamp || '')) ? new Date(Number(timestamp) * 1000) : null;
  return at && Number.isFinite(at.getTime()) ? at : fallback;
}
async function applyDeliveryStatus({ model, item, stateField = 'status', correlationField = 'deduplicationKey', conversation = false, notification = false, now = () => new Date(), detailed = false }) {
  // Optional observation only: preserve the boolean API and every transition/CAS.
  const result = (outcome, reason) => detailed ? { outcome, ...(reason ? { reason } : {}) } : ['applied', 'ignored'].includes(outcome);
  const next = Object.hasOwn(STATUS_MAP, item?.status) ? STATUS_MAP[item.status] : null;
  if (!next || !item.id) return result('invalid');
  // Compare-and-set prevents concurrent callbacks from overwriting stronger states.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const found = await model.findUnique({ where: { providerMessageId: item.id } })
      || (item.biz_opaque_callback_data ? await model.findUnique({ where: { [correlationField]: item.biz_opaque_callback_data } }) : null);
    if (!found) return result('uncorrelated');
    const row = { ...found };
    if (row.providerMessageId && row.providerMessageId !== item.id) return result('ignored', 'IDENTIFIER_MISMATCH');
    const current = row[stateField];
    if (current === 'CANCELLED') return result('ignored', 'CANCELLED');
    if (current === 'FAILED' && row.failureCode !== UNCERTAIN
      && !(row.providerMessageId === item.id && ['DELIVERED', 'READ'].includes(next))) return result('ignored', 'TERMINAL_FAILURE');
    if (next !== 'FAILED' && (STATUS_RANK[current] || 0) >= STATUS_RANK[next]) return result('ignored', 'MONOTONE_OR_DUPLICATE');
    if (next === 'FAILED' && ['DELIVERED', 'READ'].includes(current)) return result('ignored', 'DELIVERY_ALREADY_PROVEN');
    const at = callbackDate(item.timestamp, now());
    const data = { [stateField]: next, providerMessageId: item.id, processingStartedAt: null,
      failureCode: next === 'FAILED' ? String(item.errors?.[0]?.code || 'PROVIDER_FAILED').slice(0, 100) : null };
    if (notification) data.failureReason = next === 'FAILED' ? 'Échec confirmé par le fournisseur.' : null;
    if (conversation) data.providerTimestamp = at;
    else {
      data[{ SENT: 'sentAt', DELIVERED: 'deliveredAt', READ: 'readAt', FAILED: 'failedAt' }[next]] = at;
      if (next !== 'FAILED') data.failedAt = null;
    }
    const updated = await model.updateMany({
      where: { id: row.id, [stateField]: current, providerMessageId: row.providerMessageId || null,
        failureCode: row.failureCode || null, attempts: row.attempts }, data,
    });
    if (updated.count) return result('applied');
  }
  // Let Meta retry rather than acknowledge a callback lost to contention.
  throw Object.assign(new Error('Conflit de mise à jour du statut WhatsApp.'), { code: 'WHATSAPP_STATUS_CONFLICT' });
}
module.exports = { UNCERTAIN, STATUS_RANK, classifySendError, retryDelay, callbackDate, applyDeliveryStatus };
