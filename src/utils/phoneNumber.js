function normalizePhoneNumber(value, countryCode = '243') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.startsWith('+')) {
    const digits = raw.slice(1).replace(/[\s().-]/g, '');
    return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
  }
  const compact = raw.replace(/[\s().-]/g, '');
  if (/^0\d{8,9}$/.test(compact) && /^\d{1,4}$/.test(countryCode)) return `+${countryCode}${compact.slice(1)}`;
  return null;
}
function isValidWhatsAppPhoneNumber(value) { return /^\+[1-9]\d{7,14}$/.test(String(value || '')); }
function maskPhoneNumber(value) {
  const normalized = String(value || '');
  if (normalized.length < 7) return '***';
  return `${normalized.slice(0, 4)}${'*'.repeat(Math.max(3, normalized.length - 7))}${normalized.slice(-3)}`;
}
function providerPhoneNumber(value) { return isValidWhatsAppPhoneNumber(value) ? value.slice(1) : null; }
module.exports = { normalizePhoneNumber, isValidWhatsAppPhoneNumber, maskPhoneNumber, providerPhoneNumber };
