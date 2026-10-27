function flag(value) { return String(value || '').toLowerCase() === 'true'; }
function integer(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function getWhatsAppConfig(env = process.env, { requireValid = false } = {}) {
  const config = {
    enabled: flag(env.WHATSAPP_ENABLED), fakeMode: flag(env.WHATSAPP_FAKE_MODE),
    workersEnabled: flag(env.WHATSAPP_WORKERS_ENABLED),
    graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION?.trim() || 'v23.0',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '',
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || '',
    appSecret: env.WHATSAPP_APP_SECRET?.trim() || '',
    defaultCountryCode: env.WHATSAPP_DEFAULT_COUNTRY_CODE?.replace(/\D/g, '') || '243',
    maxAttempts: integer(env.WHATSAPP_MAX_ATTEMPTS, 3, 1, 10),
    batchSize: integer(env.WHATSAPP_BATCH_SIZE, 50, 1, 100),
    followUp48h: true,
    prospectFollowUpsEnabled: flag(env.NVA_FOLLOWUPS_ENABLED),
    prospectFollowUpsDryRun: env.NVA_FOLLOWUPS_DRY_RUN !== 'false',
    prospectFollowUpFrTemplate: env.NVA_FOLLOWUP_FR_TEMPLATE?.trim() || 'nva_followup_fr',
    prospectFollowUpEnTemplate: env.NVA_FOLLOWUP_EN_TEMPLATE?.trim() || 'nva_followup_en',
    prospectFollowUpFrTemplateId: env.NVA_FOLLOWUP_FR_TEMPLATE_ID?.trim() || '',
    prospectFollowUpEnTemplateId: env.NVA_FOLLOWUP_EN_TEMPLATE_ID?.trim() || '',
    prospectFollowUp24hTemplate: env.WHATSAPP_PROSPECT_FOLLOW_UP_24H_TEMPLATE?.trim() || '',
    prospectFollowUp72hTemplate: env.WHATSAPP_PROSPECT_FOLLOW_UP_72H_TEMPLATE?.trim() || '',
  };
  if (config.enabled && requireValid) {
    const required = ['phoneNumberId','businessAccountId','verifyToken','appSecret', ...(!config.fakeMode ? ['accessToken'] : [])];
    const missing = required.filter((key) => !config[key]);
    if (missing.length) throw new Error(`Configuration WhatsApp incomplète: ${missing.join(', ')}.`);
    if (env.NODE_ENV === 'production' && config.fakeMode) throw new Error('WHATSAPP_FAKE_MODE est interdit en production.');
    if (!/^\d+$/.test(config.phoneNumberId) || !/^\d+$/.test(config.businessAccountId)) throw new Error('Identifiants de compte WhatsApp invalides.');
    if (!/^v\d+\.\d+$/.test(config.graphApiVersion)) throw new Error('Version Graph API WhatsApp invalide.');
    for (const templateName of [config.prospectFollowUp24hTemplate, config.prospectFollowUp72hTemplate].filter(Boolean)) {
      if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw new Error('Nom de modèle WhatsApp de relance invalide.');
    }
  }
  return config;
}
module.exports = { getWhatsAppConfig };
