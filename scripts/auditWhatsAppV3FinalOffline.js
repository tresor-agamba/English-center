// Adversarial diagnostic probes, no provider calls, no DB and no dotenv.
const fs = require('node:fs'), path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createQuestionAIService, buildFacts } = require('../src/services/whatsappQuestionAIService');
const { detectLanguage } = require('../src/services/whatsappAdvisorPolicy');
const { getWhatsAppConfig } = require('../src/config/whatsappConfig');
async function main() {
  const results = [], course = { id: 1, title: 'Anglais général', slug: 'anglais-general', structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16, accessPolicy: 'LEGACY_STAGED', price: 60, currency: 'USD', certificateFee: 20, pricingActive: true, pricingMode: 'ONE_TIME' };
  const env = { NVA_AI_ENABLED: 'true', OPENAI_API_KEY: randomUUID(), OPENAI_MODEL: 'gpt-4.1-mini' };
  let transport;
  for (const reply of ['Vous pouvez payer par PayPal.', 'Notre certificat est reconnu dans le monde entier.', 'Votre dossier est accepté, bienvenue parmi nos étudiants.']) {
    const ai = createQuestionAIService({ env, fetchImpl: async (url, options) => {
      transport = { url, ...JSON.parse(options.body) };
      return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ language: 'fr', factIds: [], reply }) }] }] }) };
    } });
    const output = await ai.answer({ question: 'Renseignez-moi', facts: buildFacts([course], []), reserve: async () => true });
    results.push({ probe: 'unsupported_generated_claim', syntheticProviderReply: reply, acceptedByService: output === reply, expected: 'reject_or_safe_fallback', providerBehaviorMeasured: false });
  }
  const languages = ['English please', 'Parlez-moi en anglais', 'in English', 'Français', 'Je préfère l’anglais'].map(input => ({ input, detected: detectLanguage(input, 'fr') }));
  const base = require('../ecosystem.config.cjs'), candidate = require('../deploy/whatsapp-chatbot/ecosystem.nva-v2.candidate.cjs');
  const files = ['.env', '.env.example', 'ecosystem.config.cjs', 'deploy/whatsapp-chatbot/operator-functions.sh', 'src/services/whatsappQuestionAIService.js', 'src/services/whatsappAdvisorPolicy.js'];
  const fingerprints = Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex')]));
  const data = { date: '2026-10-26', realProviderCalls: 0, contract: { endpoint: transport.url, model: transport.model, store: transport.store, toolsPresent: Boolean(transport.tools), strictSchema: transport.text.format.strict },
    unsupportedClaims: results, languages, pm2: { baseDeclared: base.apps.map(a => ({ name: a.name, script: a.script })), candidateDeclared: candidate.apps.map(a => ({ name: a.name, script: a.script })), liveProcessesVerified: false, reason: 'No Contabo access; no local PM2 command available. Never treat declared names as live names.' },
    defaultFollowups: { enabled: getWhatsAppConfig({}).prospectFollowUpsEnabled, dryRun: getWhatsAppConfig({}).prospectFollowUpsDryRun }, fingerprints };
  const out = path.resolve(__dirname, '../output/nva-v3-corrections/offline-audit.json'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ unsupportedClaimsAccepted: results.filter(r => r.acceptedByService).length, languages, contract: data.contract, realProviderCalls: 0 }));
}
main().catch(() => { console.error('V3_OFFLINE_AUDIT_FAILED'); process.exitCode = 1; });
