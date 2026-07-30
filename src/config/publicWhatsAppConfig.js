function normalizePublicWhatsAppNumber(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('+') || /\s/.test(raw) || /\D/.test(raw)) return '';
  if (raw.startsWith('0') || raw.length < 8 || raw.length > 15) return '';
  return raw;
}

function getPublicWhatsAppNumber(env = process.env) {
  return normalizePublicWhatsAppNumber(env.PUBLIC_WHATSAPP_NUMBER);
}

module.exports = { getPublicWhatsAppNumber, normalizePublicWhatsAppNumber };
