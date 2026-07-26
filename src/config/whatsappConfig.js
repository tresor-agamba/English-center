function flag(value) { return String(value || '').toLowerCase() === 'true'; }
function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function getWhatsAppConfig(env = process.env, { requireValid = false } = {}) {
  const config = {
    enabled: flag(env.WHATSAPP_ENABLED), fakeMode: flag(env.WHATSAPP_FAKE_MODE),
    graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v23.0',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '',
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || '',
    appSecret: env.WHATSAPP_APP_SECRET?.trim() || '',
    defaultCountryCode: env.WHATSAPP_DEFAULT_COUNTRY_CODE?.replace(/\D/g, '') || '243',
    maxAttempts: integer(env.WHATSAPP_MAX_ATTEMPTS, 3, 1, 10),
    batchSize: integer(env.WHATSAPP_BATCH_SIZE, 50, 1, 100),
  };
  if (config.enabled && requireValid) {
    const required = config.fakeMode ? ['verifyToken','appSecret'] : ['phoneNumberId','accessToken','verifyToken','appSecret'];
    const missing = required.filter((key) => !config[key]);
    if (missing.length) throw new Error(`Configuration WhatsApp incomplète: ${missing.join(', ')}.`);
    if (process.env.NODE_ENV === 'production' && config.fakeMode) throw new Error('WHATSAPP_FAKE_MODE est interdit en production.');
  }
  return config;
}
module.exports = { getWhatsAppConfig };
