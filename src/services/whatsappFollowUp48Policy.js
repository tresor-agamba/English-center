const HOURS_48 = 48 * 3600000;
const RETENTION_MS = 90 * 24 * 3600000;
function templateFor(config, language) {
  return language === 'en' ? config.prospectFollowUpEnTemplate : config.prospectFollowUpFrTemplate;
}
// Read again inside the existing recipient transaction before engaging submission.
async function eligible48(database, row, now, config) {
  const c = row.conversation;
  const state = c?.engineState || {};
  if (c?.controlState !== 'BOT_ACTIVE' || row.sequenceHours !== 48 || !state.selectedCourseId || state.optedOut || state.automationPaused) return false;
  if (state.commercialConsentNoticeVersion !== 'lead-follow-up-48h-v3') return false;
  const consent = await database.whatsAppCommercialConsentEvent.findFirst({ where: { conversationId: row.conversationId, scope: 'COMMERCIAL_FOLLOW_UPS' }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
  if (consent?.decision !== 'GRANTED' || consent.id !== row.consentEventId) return false;
  const users = await database.user.findMany({ where: { OR: [
    { phoneNumber: c.phoneNumber }, { whatsappNumber: c.phoneNumber }, ...(c.userId ? [{ id: c.userId }] : []),
  ] }, select: { id: true } });
  if (users.length && await database.enrollment.findFirst({ where: { userId: { in: users.map(u => u.id) } }, select: { id: true } })) return false;
  const last = await database.whatsAppConversationMessage.findFirst({
    where: { conversationId: row.conversationId, direction: 'INBOUND' }, orderBy: { id: 'desc' },
    select: { receivedAt: true },
  });
  const age = +now - +new Date(last?.receivedAt);
  if (!Number.isFinite(age) || age < HOURS_48 || age > RETENTION_MS) return false;
  const pending = await database.whatsAppAdmissionRequest.findFirst({ where: {
    OR: [{ conversationId: c.id }, { phoneNumber: c.phoneNumber }],
    status: { in: ['PENDING', 'PROCESSING', 'ENROLLED'] },
  }, select: { id: true } });
  return !pending && row.templateName === templateFor(config, state.preferredLanguage)
    && row.templateLanguage === (state.preferredLanguage === 'en' ? 'en' : 'fr');
}
async function verifyTemplate(config, row, fetchImpl = globalThis.fetch) {
  const expectedId = row.templateLanguage === 'en' ? config.prospectFollowUpEnTemplateId : config.prospectFollowUpFrTemplateId;
  if (!/^\d+$/.test(expectedId || '') || !/^\d+$/.test(config.businessAccountId || '')
    || !/^v\d+\.\d+$/.test(config.graphApiVersion || '')) return false;
  try {
    const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${config.businessAccountId}/message_templates`);
    url.searchParams.set('name', row.templateName);
    url.searchParams.set('fields', 'id,name,status,category,language,components');
    const response = await fetchImpl(url.toString(), { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + config.accessToken } });
    if (!response.ok) return false;
    const body = await response.json();
    // V3 templates have static bodies, no variables, headers or URL buttons.
    return (body.data || []).some(t => t.id === expectedId && t.name === row.templateName
      && t.status === 'APPROVED' && t.category === 'MARKETING' && t.language === row.templateLanguage
      && Array.isArray(t.components) && t.components.length === 1 && t.components[0].type === 'BODY'
      && typeof t.components[0].text === 'string' && !t.components[0].text.includes('{{'));
  } catch { return false; }
}
module.exports = { HOURS_48, RETENTION_MS, templateFor, eligible48, verifyTemplate };
