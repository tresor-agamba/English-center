const crypto = require('crypto');
const LEVELS = new Set(['INFO', 'WARN', 'ERROR', 'SECURITY', 'AUDIT']);
const SECRET_KEYS = /password|secret|token|cookie|authorization|signature|stamp|binary|card|bank/i;
function sanitize(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (value instanceof Error) return { name: value.name, code: value.code, message: String(value.message || '').replace(/[A-Z]:\\[^\s]+/gi, '[PATH]') };
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, item]) => [key, sanitize(item, depth + 1)]));
  if (typeof value === 'string') return value.slice(0, 2000);
  return value;
}
function log(level, action, data = {}) {
  const safeLevel = LEVELS.has(level) ? level : 'INFO';
  const entry = { timestamp: new Date().toISOString(), level: safeLevel, action, ...sanitize(data) };
  const output = JSON.stringify(entry);
  (safeLevel === 'ERROR' ? console.error : safeLevel === 'WARN' || safeLevel === 'SECURITY' ? console.warn : console.log)(output);
  return entry;
}
const requestId = () => crypto.randomUUID();
module.exports = { log, sanitize, requestId, info: (a, d) => log('INFO', a, d), warn: (a, d) => log('WARN', a, d), error: (a, d) => log('ERROR', a, d), security: (a, d) => log('SECURITY', a, d), audit: (a, d) => log('AUDIT', a, d) };
