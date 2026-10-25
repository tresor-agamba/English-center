const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createConversationEngine,
  detectIntent,
  MAX_PROCESSED_MESSAGE_IDS,
} = require('../src/services/whatsappConversationEngine');

const catalogCourses = [
  {
    id: 11, slug: 'anglais-general', title: 'Anglais général',
    shortDescription: 'Formation générale publiée.',
    courseType: 'GENERAL_ENGLISH', structureType: 'SIMPLE', accessPolicy: 'LEGACY_STAGED',
    price: 120, currency: 'USD', pricingMode: 'ONE_TIME', pricingActive: true,
    upcomingSessionCount: 1,
  },
  {
    id: 12, slug: 'anglais-business', title: 'Anglais des affaires',
    shortDescription: 'Formation professionnelle publiée.',
    courseType: 'BUSINESS_ENGLISH', structureType: 'SIMPLE', accessPolicy: 'FULL_PAYMENT',
    price: 240, currency: 'USD', pricingMode: 'ONE_TIME', pricingActive: true,
    upcomingSessionCount: 0,
  },
];

function makeEngine({ courses = catalogCourses, registrationCourses, catalogError = false, now, whatsappConfig } = {}) {
  return createConversationEngine({
    catalog: {
      listPublished: async () => {
        if (catalogError) throw new Error('test provider unavailable');
        return courses;
      },
    },
    registration: {
      listCoursesForPublicRegistration: async () => registrationCourses || [
        {
          id: 11, slug: 'anglais-general', title: 'Anglais général',
          structureType: 'SIMPLE', accessPolicy: 'LEGACY_STAGED', numberOfLevels: null, sessionCount: 16,
          session: {
            id: 101, levelNumber: null, startDate: new Date('2027-02-01T00:00:00Z'), timezone: 'Africa/Kinshasa',
            weekDays: ['Lundi', 'Mercredi'], startTime: '18:00', endTime: '19:30',
            registrationGroups: [{ id: 4, name: 'Soir', weekDays: ['Lundi', 'Mercredi'], startTime: '18:00', endTime: '19:30', isActive: true, isFull: false }],
          },
        },
        {
          id: 12, slug: 'anglais-business', title: 'Anglais des affaires',
          structureType: 'SIMPLE', accessPolicy: 'FULL_PAYMENT', numberOfLevels: null, sessionCount: 16,
          session: { id: 102, weekDays: ['Samedi'], startTime: '09:00', endTime: '10:30', timezone: 'Africa/Kinshasa', registrationGroups: [] },
        },
      ],
    },
    ...(now ? { now } : {}),
    ...(whatsappConfig ? { whatsappConfig } : {}),
  });
}

test('détecte les intentions déterministes, les ambiguïtés et les messages incompris', () => {
  assert.equal(detectIntent('Bonjour'), 'GREETING');
  assert.equal(detectIntent('Combien coûte Anglais général ?'), 'PRICE');
  assert.equal(detectIntent('Quels sont les horaires ?'), 'SCHEDULE');
  assert.equal(detectIntent('Je veux faire un essai'), 'TRIAL');
  assert.equal(detectIntent('Je veux m’inscrire'), 'REGISTRATION');
  assert.equal(detectIntent('Je veux le prix et les horaires'), 'AMBIGUOUS');
  assert.equal(detectIntent('xyz blorpt'), 'UNKNOWN');
  assert.equal(detectIntent('Désinscrire'), 'OPT_OUT');
});

test('demande un accord explicite après une information commerciale et refuse un accord sans demande préalable', async () => {
  const engine = makeEngine({ whatsappConfig: () => ({ prospectFollowUp24hTemplate: 'nva_follow_up_24h', prospectFollowUp72hTemplate: 'nva_follow_up_72h' }), now: () => new Date('2026-10-09T12:00:00Z') });
  const prompt = await engine.handleMessage({ text: 'formations', messageId: 'inquiry-1' });
  assert.match(prompt.text, /deux messages commerciaux de suivi/);
  assert.equal(prompt.state.commercialFollowUpConsentRequestedAt, '2026-10-09T12:00:00.000Z');
  const accepted = await engine.handleMessage({ text: 'OUI RELANCES', messageId: 'grant-1', state: prompt.state });
  assert.equal(accepted.actions[0].type, 'COMMERCIAL_CONSENT_GRANT');
  assert.equal(accepted.state.commercialFollowUpsGranted, true);

  const unsolicited = await engine.handleMessage({ text: 'OUI RELANCES', messageId: 'grant-2' });
  assert.equal(unsolicited.actions.length, 0);
  assert.equal(unsolicited.intent, 'COMMERCIAL_CONSENT_NOT_REQUESTED');
  const enrolled = await engine.handleMessage({ text: 'formations', messageId: 'enrolled-1', allowCommercialFollowUpConsent: false });
  assert.doesNotMatch(enrolled.text, /OUI RELANCES/);
  const enrolledGrant = await engine.handleMessage({ text: 'OUI RELANCES', messageId: 'enrolled-grant', state: prompt.state, allowCommercialFollowUpConsent: false });
  assert.equal(enrolledGrant.actions.length, 0);
  assert.equal(enrolledGrant.intent, 'COMMERCIAL_FOLLOW_UP_UNAVAILABLE');
});

test('accueille et présente les cours depuis le fournisseur du catalogue', async () => {
  const engine = makeEngine();
  const greeting = await engine.handleMessage({ text: 'Bonjour' });
  assert.equal(greeting.text, (await engine.handleMessage({ text: 'Menu' })).text);
  const response = await engine.handleMessage({ text: 'Quelles formations ?' });
  assert.match(response.text, /Anglais général/);
  assert.match(response.text, /inscriptions ouvertes/);
  assert.match(response.text, /pas de session ouverte actuellement/);
});

test('donne le tarif réel et distingue un tarif par niveau si applicable', async () => {
  const engine = makeEngine();
  const response = await engine.handleMessage({ text: 'Quel est le prix de Anglais général ?' });
  assert.match(response.text, /120\s?USD/);
  assert.doesNotMatch(response.text, /paiement créé/i);
});

test('ne fabrique pas de tarif quand il est désactivé ou absent', async () => {
  const engine = makeEngine({ courses: [{ ...catalogCourses[0], pricingActive: false }] });
  const response = await engine.handleMessage({ text: 'Quel est le tarif de Anglais général ?' });
  assert.match(response.text, /pas actuellement disponible/);
});

test('ne présente pas comme actuel un tarif dont la période de validité est passée ou future', async () => {
  const now = () => new Date('2026-10-09T12:00:00Z');
  for (const dateFields of [
    { pricingStartsAt: new Date('2026-10-10T00:00:00Z') },
    { pricingEndsAt: new Date('2026-10-09T12:00:00Z') },
  ]) {
    const engine = makeEngine({ courses: [{ ...catalogCourses[0], ...dateFields }], now });
    const response = await engine.handleMessage({ text: 'Quel est le tarif de Anglais général ?' });
    assert.match(response.text, /pas actuellement disponible/);
  }
});

test('demande une précision lorsque le cours recherché pour le prix est ambigu ou absent', async () => {
  const engine = makeEngine();
  const response = await engine.handleMessage({ text: 'Quel est le prix ?' });
  assert.match(response.text, /Pour quel cours/);
});

test('communique uniquement les horaires des sessions d’inscription disponibles', async () => {
  const engine = makeEngine();
  const response = await engine.handleMessage({ text: 'Les horaires de Anglais général ?' });
  assert.match(response.text, /18:00–19:30/);
  assert.match(response.text, /Lundi, Mercredi/);
});

test('explique les cinq séances selon la règle du cours et respecte le cours à paiement complet', async () => {
  const engine = makeEngine();
  const legacy = await engine.handleMessage({ text: 'Je peux faire un essai pour Anglais général ?' });
  assert.match(legacy.text, /5 séances d’essai/);
  const full = await engine.handleMessage({ text: 'Puis-je essayer Anglais des affaires ?' });
  assert.match(full.text, /ne prévoient pas de séances d’essai avant paiement/);
});

test('fournit le lien officiel sans créer inscription ni paiement', async () => {
  const engine = makeEngine();
  const response = await engine.handleMessage({ text: 'Je veux m’inscrire à Anglais général', publicAppUrl: 'https://nva.example' });
  assert.match(response.text, /https:\/\/nva\.example\/register\?session=101/);
  assert.equal(response.actions.length, 0);
});

test('ne fabrique aucun lien si la base URL publique manque', async () => {
  const engine = makeEngine({ registrationCourses: [{ id: 3, slug: 'x', title: 'Cours X', session: { id: 9 } }] });
  const response = await engine.handleMessage({ text: 'Je veux m’inscrire à Cours X' });
  assert.match(response.text, /lien officiel n’est pas configuré/);
  assert.doesNotMatch(response.text, /https?:\/\//);
});

test('répond aux objections sans promettre remise ou résultat', async () => {
  const response = await makeEngine().handleMessage({ text: 'C’est trop cher' });
  assert.equal(response.intent, 'OBJECTION');
  assert.match(response.text, /vérifier le tarif ou les horaires/);
  assert.doesNotMatch(response.text, /remise|garanti/i);
});

test('gère qualification et message incompris', async () => {
  const engine = makeEngine();
  const qualification = await engine.handleMessage({ text: 'Je souhaite améliorer mon anglais pour mon travail' });
  assert.equal(qualification.intent, 'QUALIFICATION');
  assert.match(qualification.state.qualification.objective, /travail/);
  const unknown = await engine.handleMessage({ text: 'xyz blorpt' });
  assert.equal(unknown.intent, 'UNKNOWN');
  assert.match(unknown.text, /Je n’ai pas bien compris/);
});

test('demande conseiller, suspend le bot, et ne reprend que sur instruction explicite', async () => {
  const engine = makeEngine();
  const handoff = await engine.handleMessage({ text: 'Je veux parler à un conseiller', messageId: 'm1' });
  assert.equal(handoff.state.automationPaused, true);
  assert.equal(handoff.actions[0].type, 'HUMAN_HANDOFF');
  const paused = await engine.handleMessage({ text: 'Quel est le prix ?', state: handoff.state, messageId: 'm2' });
  assert.equal(paused.text, null);
  const resumed = await engine.handleMessage({ text: 'reprendre bot', state: paused.state, messageId: 'm3' });
  assert.equal(resumed.state.automationPaused, false);
  assert.equal(resumed.actions[0].type, 'RESUME_AUTOMATION');
});

test('traite le retrait en priorité, désactive les réponses et émet une action opt-out', async () => {
  const engine = makeEngine();
  const response = await engine.handleMessage({ text: 'ARRET', messageId: 'stop-1' });
  assert.equal(response.text, null);
  assert.equal(response.state.optedOut, true);
  assert.equal(response.state.automationPaused, true);
  assert.equal(response.actions[0].type, 'OPT_OUT');
  const later = await engine.handleMessage({ text: 'bonjour', state: response.state, messageId: 'after-stop' });
  assert.equal(later.text, null);
});

test('déduplique les messages entrants par identifiant', async () => {
  const engine = makeEngine();
  const first = await engine.handleMessage({ text: 'bonjour', messageId: 'wamid.1' });
  const duplicate = await engine.handleMessage({ text: 'bonjour', messageId: 'wamid.1', state: first.state });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.text, null);
});

test('borne la liste d’identifiants de messages traités', async () => {
  const engine = makeEngine();
  const state = { processedMessageIds: Array.from({ length: MAX_PROCESSED_MESSAGE_IDS }, (_, i) => `id-${i}`) };
  const response = await engine.handleMessage({ text: 'bonjour', messageId: 'new-id', state });
  assert.equal(response.state.processedMessageIds.length, MAX_PROCESSED_MESSAGE_IDS);
  assert.equal(response.state.processedMessageIds.at(-1), 'new-id');
});

test('signale une erreur temporaire sans marquer le message comme traité', async () => {
  const engine = makeEngine({ catalogError: true });
  const response = await engine.handleMessage({ text: 'Quelles formations ?', messageId: 'retry-me' });
  assert.equal(response.retryable, true);
  assert.match(response.text, /pour le moment/);
  assert.equal(response.state.processedMessageIds.includes('retry-me'), false);
});
