const crypto = require('crypto');
const logger = require('./loggerService');
const attempts = new Map();
const MAX = 5, WINDOW = 15 * 60 * 1000;
const key = (phone) => crypto.createHash('sha256').update(String(phone || '').trim()).digest('hex');
function check(ip, phone) {
  const now = Date.now();
  for (const candidate of [`ip:${ip}`, `account:${key(phone)}`]) {
    const row = attempts.get(candidate);
    if (row && row.until > now && row.count >= MAX) {
      const error = new Error('Trop de tentatives. Réessayez plus tard.'); error.statusCode = 429; error.code = 'LOGIN_LOCKED'; throw error;
    }
  }
}
function failed(ip, phone, requestId) {
  const now = Date.now();
  for (const candidate of [`ip:${ip}`, `account:${key(phone)}`]) {
    const row = attempts.get(candidate); const count = row && row.until > now ? row.count + 1 : 1;
    attempts.set(candidate, { count, until: now + WINDOW });
    if (count >= MAX) logger.security('LOGIN_BRUTE_FORCE', { requestId, ip, scope: candidate.startsWith('ip:') ? 'IP' : 'ACCOUNT', count });
  }
}
function succeeded(ip, phone) { attempts.delete(`ip:${ip}`); attempts.delete(`account:${key(phone)}`); }
function reset() { attempts.clear(); }
module.exports = { check, failed, succeeded, reset, MAX };
