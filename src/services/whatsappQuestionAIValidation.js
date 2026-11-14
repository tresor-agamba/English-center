// Legacy fact plans and grounded natural prose. Sensitive claims remain verified before publication.
const { OPENINGS, QUESTIONS, renderPlan } = require('./whatsappAdvisorPolicy');
const INTENTS = Object.freeze([
  'INFORMATION', 'UNKNOWN_INFORMATION', 'GREETING', 'THANKS', 'LEARNING_ADVICE', 'IDENTITY',
  'CLARIFY', 'ADVISER', 'PAYMENT_STATUS', 'ENROLLMENT_STATUS', 'REGISTRATION',
]);
const MAX_FACTS = 12;
const MESSAGES = Object.freeze({
  GREETING: {
    fr: 'Bonjour ! 😊 Comment puis-je vous aider dans votre projet de formation ?',
    en: 'Hello! 😊 How can I help with your learning plans?',
  },
  THANKS: { fr: 'Avec plaisir ! Je reste à votre écoute.', en: 'You’re welcome! I am here if you have more questions.' },
  LEARNING_ADVICE: {
    fr: 'Pour progresser en anglais, pratiquez régulièrement : écoutez de courts dialogues, lisez à votre niveau et entraînez-vous à parler. Quel objectif souhaitez-vous travailler ?',
    en: 'To improve your English, practise regularly: listen to short dialogues, read at your level and practise speaking. What goal would you like to work on?',
  },
  IDENTITY: {
    fr: 'Je suis NVA Assistant, l’assistant virtuel de New Vision Academy. Je peux vous aider à consulter les formations et leurs conditions officielles ou vous guider vers un conseiller.',
    en: 'I am NVA Assistant, New Vision Academy’s virtual assistant. I can help you explore courses and their official terms or guide you to an adviser.',
  },
  CLARIFY: {
    fr: 'Quel point souhaitez-vous préciser ?',
    en: 'What would you like to clarify?',
  },
  ADVISER: {
    fr: 'Pour joindre un conseiller NVA, écrivez « conseiller ». Il pourra examiner votre demande.',
    en: 'To reach an NVA adviser, type “conseiller”. They can review your request.',
  },
  PAYMENT_STATUS: {
    fr: 'Je ne peux pas vérifier la réception de votre paiement dans ce chat. Écrivez « conseiller » pour demander une vérification à NVA.',
    en: 'I cannot verify receipt of your payment in this chat. Type “conseiller” to ask NVA to check it.',
  },
  ENROLLMENT_STATUS: {
    fr: 'Je ne peux pas confirmer votre inscription dans ce chat. Elle reste soumise aux vérifications et à la décision administrative de NVA. Écrivez « conseiller » pour faire vérifier votre dossier.',
    en: 'I cannot confirm your enrollment in this chat. It remains subject to NVA’s checks and administrative decision. Type “conseiller” to have your application checked.',
  },
});
function outputSchema(facts) {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      language: { type: 'string', enum: ['fr', 'en'] },
      intent: { type: 'string', enum: [...INTENTS] },
      factIds: { type: 'array', items: { type: 'string', enum: facts.map(f => f.id) }, maxItems: MAX_FACTS },
      opening: { type: 'string', enum: Object.keys(OPENINGS) },
      followUp: { type: 'string', enum: Object.keys(QUESTIONS) },
      action: { type: 'string', enum: ['NONE', 'REGISTER'] },
      responseTemplate: { type: 'string', maxLength: 1800 },
    },
    required: ['language', 'intent', 'factIds', 'opening', 'followUp', 'action', 'responseTemplate'],
  };
}
function validatePlan(plan, facts, language) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return 'JSON_INVALID';
  const keys = ['language', 'intent', 'factIds', 'opening', 'followUp', 'action'];
  if(Object.hasOwn(plan,'responseTemplate'))keys.push('responseTemplate');
  if (Object.keys(plan).length !== keys.length || !keys.every(k => Object.hasOwn(plan, k))) return 'PLAN_INVALID';
  if (plan.language !== language || !['fr', 'en'].includes(plan.language)) return 'LANGUAGE_MISMATCH';
  if (!Array.isArray(plan.factIds) || plan.factIds.length > MAX_FACTS
    || new Set(plan.factIds).size !== plan.factIds.length
    || plan.factIds.some(id => typeof id !== 'string' || !facts.some(f => f.id === id))) return 'FACT_ID_INVALID';
  if (!INTENTS.includes(plan.intent) || typeof plan.opening !== 'string' || typeof plan.followUp !== 'string'
    || !Object.hasOwn(OPENINGS, plan.opening)
    || !Object.hasOwn(QUESTIONS, plan.followUp) || !['NONE', 'REGISTER'].includes(plan.action)) return 'PLAN_INVALID';
  if ((plan.intent === 'REGISTRATION') !== (plan.action === 'REGISTER')) return 'PLAN_INVALID';
  // Non-catalogue replies have their own complete reviewed text. The model cannot
  // append facts or dialogue to impersonate verification or alter that text.
  if (!['INFORMATION','UNKNOWN_INFORMATION'].includes(plan.intent) && (plan.factIds.length || plan.opening !== 'none' || plan.followUp !== 'none')) return 'PLAN_INVALID';
  if (plan.intent === 'INFORMATION' && !plan.factIds.length && plan.followUp === 'none') return 'FACT_ID_REQUIRED';
  if(plan.intent==='UNKNOWN_INFORMATION'&& (typeof plan.responseTemplate!=='string'||!plan.responseTemplate.trim()))return 'PROSE_REJECTED';
  if(Object.hasOwn(plan,'responseTemplate') && !validTemplate(plan) && !naturalTemplate(plan,facts))return 'PROSE_REJECTED';
  return null;
}
function validTemplate(plan){return templateRule(plan)===null;}
function templateRule(plan){
 const value=plan.responseTemplate;
 if(typeof value!=='string')return 'TEXT_TYPE';
 if(value.length>1800)return 'TEXT_TOO_LONG';
 if(!value)return null;
 if(plan.intent!=='INFORMATION')return 'TEMPLATE_INTENT';
 const ids=[...value.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(m=>m[1]);
 if(ids.length!==plan.factIds.length||new Set(ids).size!==ids.length||ids.some(id=>!plan.factIds.includes(id)))return 'PLACEHOLDER_SET';
 const framing=value.replace(/\{\{[a-zA-Z0-9_]+\}\}/g,'');
 // Only conversational framing may be generated. All business-bearing clauses
 // (including spelled-out amounts and availability) must be fact placeholders.
 return framing.split(/[.!?\n:]+/).filter(t=>t.trim()).every(t=>/^(?:[\p{Extended_Pictographic}\s,;*’'–-])*(?:pour (?:le soir|vous|votre question)|voici (?:les informations|le creneau|le créneau|les details|les détails|la reponse|la réponse)|bien sur|bien sûr|oui|d accord|d’accord|je vous ecoute|je vous écoute|souhaitez-vous preciser votre question|souhaitez-vous préciser votre question|for (?:the evening|you)|here (?:are the details|is the information)|of course)[\p{Extended_Pictographic}\s,;*’'–-]*$/iu.test(t)) ? null : 'FRAMING_NOT_ALLOWED';
}
// Free prose is published only after the independent grounded verification in the service.
function naturalTemplate(plan,facts){return naturalRule(plan,facts)===null;}
function naturalRule(plan,facts){
 const text=plan.responseTemplate;
 if(!['INFORMATION','UNKNOWN_INFORMATION'].includes(plan.intent))return 'NATURAL_INTENT';
 if(typeof text!=='string')return 'TEXT_TYPE';
 if(!text.trim())return 'TEXT_EMPTY';
 if(text.length>1800)return 'TEXT_TOO_LONG';
 if(/[{}<>\x00-\x08]/.test(text))return 'FORBIDDEN_CHARACTERS';
 const source=plan.factIds.map(id=>facts.find(f=>f.id===id)?.[plan.language]||'').join(' ');
 const numbers=value=>value.match(/\d+(?:[.,:]\d+)?/g)||[];
 if(numbers(text).some(n=>!numbers(source).includes(n)))return 'NUMBER_NOT_IN_SELECTED_FACTS';
 const emails=text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[];
 if(emails.some(email=>!source.includes(email)))return 'EMAIL_NOT_IN_SELECTED_FACTS';
 const links=text.match(/https?:\/\/[^\s)]+/g)||[];
 if(links.some(link=>!source.includes(link)))return 'LINK_NOT_IN_SELECTED_FACTS';
 return null;
}
// Fixed enum values only: never expose text, facts, identifiers or matched values.
function proseRejectionRules(plan,facts){
 if(plan.intent==='UNKNOWN_INFORMATION'&&(typeof plan.responseTemplate!=='string'||!plan.responseTemplate.trim()))return {proseRule:'UNKNOWN_TEXT_REQUIRED'};
 return {templateRule:templateRule(plan),naturalRule:naturalRule(plan,facts)};
}
function needsGrounding(plan){return Boolean(plan.responseTemplate)&&!validTemplate(plan);}
function renderVerifiedPlan(plan, facts, language, history = [], grounded = false) {
  if (validatePlan(plan, facts, language)) return null;
  if (plan.intent === 'REGISTRATION') return { action: 'REGISTER' };
  if (!['INFORMATION','UNKNOWN_INFORMATION'].includes(plan.intent)) return MESSAGES[plan.intent][language];
  // Preserve fact boundaries and every condition; never extract numbers, paraphrase
  // or truncate an official assertion. Only server-owned strings reach the user.
  const selected = plan.factIds.map(id => facts.find(f => f.id === id));
  if(needsGrounding(plan))return grounded ? plan.responseTemplate.trim() : null;
  if(plan.responseTemplate){const seen=new Set();return plan.responseTemplate.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g,(_,id)=>{const text=selected.find(f=>f.id===id)[language];if(seen.has(text))return '';seen.add(text);return text;}).replace(/\n{3,}/g,'\n\n').trim();}
  return renderPlan(plan, selected, language, history);
}
module.exports = { INTENTS, MAX_FACTS, MESSAGES, outputSchema, validatePlan, renderVerifiedPlan, needsGrounding, proseRejectionRules };
