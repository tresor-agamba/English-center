const { normalizeText } = require('./whatsappConversationEngine');
const AI_FALLBACK = 'Je ne dispose pas de cette information officielle. Écrivez « conseiller » pour obtenir de l’aide.';
const SAFE_INTENTS = new Set(['GREETING', 'MENU', 'UNKNOWN']);
function invalid() { return Object.assign(new Error('Configuration chatbot invalide.'), { statusCode: 400 }); }
function validateRule(input) {
  if (!input || !['MESSAGE','FAQ'].includes(input.kind)) throw invalid();
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const raw = Array.isArray(input.triggers) ? input.triggers : typeof input.triggers === 'string' ? input.triggers.split(/[,\n]/) : [];
  if (raw.some(x => typeof x !== 'string')) throw invalid();
  const triggers = [...new Set(raw.map(normalizeText).filter(Boolean))];
  const priority = Number(input.priority);
  if (!title || title.length > 120 || !body || body.length > 3000 || !triggers.length || triggers.length > 20 || triggers.some(x => x.length > 100) || !Number.isInteger(priority) || priority < 0 || priority > 1000) throw invalid();
  return { kind: input.kind, title, body, triggers, priority, enabled: input.enabled === true || input.enabled === 'on' };
}
function matchRule(rules, text) {
  const query = ' ' + normalizeText(text) + ' ';
  return [...rules].filter(r => r.enabled && Array.isArray(r.triggers) && r.triggers.some(t => query.includes(' ' + normalizeText(t) + ' '))).sort((a,b) => b.priority-a.priority || a.id-b.id)[0] || null;
}
function createChatbotService({ database, ai = null, deferAI = false } = {}) {
  async function resolve({ text, intent, state, allowAI = false }) {
    if (state?.optedOut || state?.automationPaused) return null;
    // Missing generated client keeps historical installations operational before migration.
    if (!database?.whatsAppChatbotRule) return null;
    const settings = await database.whatsAppChatbotSettings.findUnique({ where: { id: 1 } });
    if (settings?.enabled === false) return { text: null, source: 'DISABLED' };
    if (!SAFE_INTENTS.has(intent) || state?.pendingQuestion) return null;
    const rules = await database.whatsAppChatbotRule.findMany({ where: { enabled: true }, orderBy: [{ priority: 'desc' }, { id: 'asc' }], take: 100 });
    const match = matchRule(rules, text);
    if (match) return { text: match.body, source: match.kind, ruleId: match.id };
    if (intent === 'UNKNOWN' && allowAI && settings?.aiEnabled && deferAI) return { text: AI_FALLBACK, source: 'AI_DEFERRED', deferredAI: true };
    if (intent === 'UNKNOWN' && allowAI && settings?.aiEnabled && ai) {
      const answer = await ai.select(text, rules.filter(r => r.kind === 'FAQ'));
      return { text: answer || AI_FALLBACK, source: 'AI' };
    }
    return null;
  }
  return { resolve };
}
module.exports = { AI_FALLBACK, validateRule, matchRule, createChatbotService, SAFE_INTENTS };
