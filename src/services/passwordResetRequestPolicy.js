const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APPROVED_TTL_MS = 24 * 60 * 60 * 1000;

function isExpired(request, now = Date.now()) {
  const field = request?.status === 'PENDING' ? 'requestedAt' : request?.status === 'APPROVED' ? 'reviewedAt' : null;
  if (!field) return false;
  const date = request[field];
  const ttl = field === 'requestedAt' ? PENDING_TTL_MS : APPROVED_TTL_MS;
  return !(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getTime() + ttl <= now;
}

// A single conditional write commits independently before an action can reject.
// Concurrent completion/review is rechecked by PostgreSQL against the current row.
function expireRequests(client, scope = {}, now = new Date()) {
  return client.passwordResetRequest.updateMany({ where: { ...scope, OR: [
    { status: 'PENDING', requestedAt: { lte: new Date(now.getTime() - PENDING_TTL_MS) } },
    { status: 'APPROVED', OR: [{ reviewedAt: null }, { reviewedAt: { lte: new Date(now.getTime() - APPROVED_TTL_MS) } }] },
  ] }, data: { status: 'EXPIRED' } });
}

module.exports = { PENDING_TTL_MS, APPROVED_TTL_MS, isExpired, expireRequests };
