const publicCourseService = require('./publicCourseService');
const registrationService = require('./registrationService');
const { buildPublicCoursePresentation } = require('../utils/publicCoursePresentation.util');
const { accessLimits } = require('./courseStructureService');
const { getWhatsAppConfig } = require('../config/whatsappConfig');

const MAX_PROCESSED_MESSAGE_IDS = 100;
const CONSENT_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONSENT_NOTICE_VERSION = 'lead-follow-up-48h-v3';
const COMMERCIAL_FOLLOW_UP_INVITATION = 'Souhaitez-vous une relance commerciale WhatsApp facultative de NVA après 48 h sans message ? Répondez « OUI RELANCES » pour accepter. Vous pouvez retirer votre accord à tout moment en répondant STOP.';
const UNKNOWN_REPLY = 'Je n’ai pas bien compris votre demande. Vous pouvez écrire « formations », « prix », « horaires », « essai », « inscription » ou « conseiller ».';
const TEMPORARY_ERROR_REPLY = 'Je ne peux pas consulter ces informations pour le moment. Réessayez dans quelques instants ou écrivez « conseiller ».';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hasAny(text, values) {
  return values.some((value) => text.includes(value));
}

function detectIntent(value) {
  const text = normalizeText(value);
  if (!text) return 'UNKNOWN';
  if (/\b(stop|unsubscribe)\b|ne m envoyez plus|ne me contactez plus|arretez les (messages|relances)|no more messages|do not contact|non relances|no follow ups/.test(text) || /^(arret|desinscrire|desabonner)$/.test(text)) return 'OPT_OUT';
  if (/^(oui relances?|yes follow ups?)$/.test(text)) return 'COMMERCIAL_CONSENT_GRANT';
  if (/\b(human adviser|human advisor|human agent|speak to someone)\b/.test(text)) return 'HUMAN_HANDOFF';
  if (hasAny(text, ['reprendre bot', 'reactiver bot', 'reprendre automatisation', 'reactiver automatisation'])) return 'RESUME_AUTOMATION';
  if (hasAny(text, ['conseiller', 'conseillere', 'humain', 'personne', 'parler a quelqu', 'agent', 'rappeler'])) return 'HUMAN_HANDOFF';
  if (/^(menu|menu principal|retour au menu|retour au menu principal|accueil)$/.test(text)) return 'MENU';
  if (/^(annuler|abandonner|laisser tomber|laisse tomber|oublie|oublier|pas maintenant)$/.test(text)) return 'CANCEL_REQUEST';
  if (/^(changer|changer de formation|autre formation|autre cours)$/.test(text)) return 'CHANGE_COURSE';

  const topics = [];
  if (hasAny(text, ['combien', 'prix', 'tarif', 'cout', 'coute', 'payer', 'paiement'])) topics.push('PRICE');
  if (hasAny(text, ['horaire', 'horaires', 'heure', 'heures', 'quand', 'planning', 'emploi du temps', 'creneau'])) topics.push('SCHEDULE');
  if (hasAny(text, ['essai', 'essayer', 'gratuit', 'seance test'])) topics.push('TRIAL');
  if (hasAny(text, ['inscrire', 'inscription', 'inscris'])) topics.push('REGISTRATION');
  if (topics.length > 1) return 'AMBIGUOUS';
  if (topics.length === 1) return topics[0];
  if (hasAny(text, ['formation', 'formations', 'cours', 'catalogue', 'programme'])) return 'CATALOG';
  if (hasAny(text, ['bonjour', 'bonsoir', 'salut', 'hello', 'coucou'])) return 'GREETING';
  if (hasAny(text, ['trop cher', 'cher', 'chere', 'pas les moyens', 'je travaille', 'indisponible', 'hesite', 'doute'])) return 'OBJECTION';
  if (hasAny(text, ['je cherche', 'je souhaite', 'je veux apprendre', 'mon objectif', 'mon niveau', 'pour mon travail', 'pour mes etudes', 'ameliorer mon anglais'])) return 'QUALIFICATION';
  return 'UNKNOWN';
}

function makeInitialState(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    automationPaused: source.automationPaused === true,
    admission: source.admission && typeof source.admission === 'object' ? source.admission : null,
    scenarioMenu: source.scenarioMenu && typeof source.scenarioMenu === 'object' && Array.isArray(source.scenarioMenu.options) ? source.scenarioMenu : null,
    optedOut: source.optedOut === true,
    mode: source.mode === 'QUESTION_AI' ? 'QUESTION_AI' : null,
    questionAIStartedAt: typeof source.questionAIStartedAt === 'string' ? source.questionAIStartedAt : null,
    preferredLanguage: source.preferredLanguage === 'en' ? 'en' : 'fr',
    commercialConsentNoticeVersion: source.commercialConsentNoticeVersion || null,
    commercialConsentRequestedVersion: source.commercialConsentRequestedVersion || null,
    processedMessageIds: Array.isArray(source.processedMessageIds)
      ? source.processedMessageIds.filter((id) => typeof id === 'string').slice(-MAX_PROCESSED_MESSAGE_IDS)
      : [],
    qualification: source.qualification && typeof source.qualification === 'object'
      ? { ...source.qualification }
      : {},
    selectedCourseSlug: typeof source.selectedCourseSlug === 'string' ? source.selectedCourseSlug : null,
    selectedCourseId: Number.isSafeInteger(source.selectedCourseId) && source.selectedCourseId > 0 ? source.selectedCourseId : null,
    lastIntent: typeof source.lastIntent === 'string' ? source.lastIntent.slice(0, 50) : null,
    pendingQuestion: source.pendingQuestion && ['COURSE', 'TOPIC'].includes(source.pendingQuestion.type)
      ? { type: source.pendingQuestion.type, intent: ['PRICE', 'SCHEDULE', 'TRIAL', 'REGISTRATION'].includes(source.pendingQuestion.intent) ? source.pendingQuestion.intent : null }
      : null,
    step: ['MENU', 'SELECT_COURSE', 'SELECT_TOPIC', 'INFORMATION', 'REGISTRATION', 'HUMAN_HANDOFF', 'OPTED_OUT'].includes(source.step) ? source.step : 'MENU',
    commercialFollowUpConsentRequestedAt: typeof source.commercialFollowUpConsentRequestedAt === 'string' ? source.commercialFollowUpConsentRequestedAt : null,
    commercialFollowUpsGranted: source.commercialFollowUpsGranted === true,
  };
}

function withMessageId(state, messageId) {
  if (!messageId) return state;
  const ids = [...state.processedMessageIds, String(messageId)].slice(-MAX_PROCESSED_MESSAGE_IDS);
  return { ...state, processedMessageIds: ids };
}

function matchCourse(text, courses) {
  const matches = matchCourses(text, courses);
  return matches.length === 1 ? matches[0] : null;
}

function courseQuery(text) {
  const ignored = new Set(('je j tu vous nous veux veut souhaite voudrais changer choisir selectionner prendre preferer plutot autre et ou de du des le la les l d un une a au aux pour sur en ce cette ces celle ci celui ca est sont quel quelle quels quelles combien coute cout prix tarif tarifs horaire horaires heure heures quand planning emploi temps creneau creneaux essai essayer peux puis faire gratuit inscription inscrire inscris m me formation formations cours catalogue programme svp merci bonjour connaitre savoir donner dites').split(' '));
  for (const word of ['modalite', 'modalites', 'actuel', 'actuelle', 'actuels', 'actuelles', 'disponible', 'disponibles', 'detail', 'details', 'aussi']) ignored.add(word);
  return normalizeText(text).split(' ').filter(word => word && !ignored.has(word));
}

function matchCourses(text, courses) {
  const normalized = normalizeText(text);
  const exact = (courses || []).filter(course => normalizeText(course.title) === normalized || normalizeText(course.slug) === normalized);
  if (exact.length) return exact;
  const full = (courses || []).filter((course) => {
    const title = normalizeText(course.title);
    return title && ` ${normalized} `.includes(` ${title} `);
  });
  if (full.length) return full;
  const words = courseQuery(text);
  return words.length ? (courses || []).filter(course => {
    const titleWords = normalizeText(course.title).split(' ');
    return words.every(word => titleWords.includes(word));
  }) : [];
}

function courseListReply(courses) {
  if (!courses.length) return 'Aucune formation publiée n’est disponible dans le catalogue pour le moment. Un conseiller peut vous renseigner.';
  const lines = courses.slice(0, 8).map((course) => {
    const availability = course.upcomingSessionCount > 0 ? 'inscriptions ouvertes' : 'pas de session ouverte actuellement';
    return `• ${course.title} — ${availability}`;
  });
  return `Voici les formations publiées :\n${lines.join('\n')}\n\nLaquelle vous intéresse ?`;
}

function formatDate(value, timezone) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: timezone || 'Africa/Kinshasa' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Africa/Kinshasa' }).format(date);
  }
}

function scheduleReply(course) {
  const session = course.session;
  if (!session) return `Je n’ai pas de créneau d’inscription ouvert pour ${course.title} actuellement. Écrivez « conseiller » pour demander d’autres possibilités.`;
  const groups = (session.registrationGroups || []).filter((group) => group.isActive && !group.isFull && group.startTime && group.endTime);
  const dayList = (days) => Array.isArray(days) && days.length ? days.join(', ') : null;
  const options = groups.map((group) => {
    const days = dayList(group.weekDays);
    return `• ${group.name}${days ? ` — ${days}` : ''}, ${group.startTime}–${group.endTime}`;
  });
  if (!options.length && !session.registrationGroups?.length && session.weekDays?.length && session.startTime && session.endTime) options.push(`• ${session.weekDays.join(', ')}, ${session.startTime}–${session.endTime}`);
  const date = formatDate(session.startDate, session.timezone);
  const header = [`Pour ${course.title}${session.levelNumber ? ` (niveau ${session.levelNumber})` : ''}${date ? `, début prévu le ${date}` : ''}.`];
  if (options.length) header.push(`Créneaux disponibles :\n${options.join('\n')}`);
  else header.push(session.registrationGroups?.length ? 'Les créneaux de groupe détaillés sont indisponibles dans les informations consultées.' : 'Les horaires détaillés ne sont pas renseignés dans les données de cette session.');
  header.push('Les disponibilités peuvent évoluer ; le formulaire les vérifiera à nouveau.');
  return header.join('\n');
}

function courseDetailsForPrice(course, buildPresentation = buildPublicCoursePresentation, now = new Date()) {
  const presentation = buildPresentation(course);
  if (!course.pricingActive || !course.pricingMode || !presentation.price
    || (course.pricingStartsAt && new Date(course.pricingStartsAt) > now)
    || (course.pricingEndsAt && new Date(course.pricingEndsAt) <= now)) {
    return `Le tarif de ${course.title} n’est pas actuellement disponible dans le catalogue. Je peux transmettre votre demande à un conseiller.`;
  }
  const lines = [`Le tarif indiqué pour ${course.title} est ${presentation.price.value}${presentation.price.perLevel ? ' par niveau' : ''}.`];
  if (presentation.indicativePrice) lines.push(`Le total indicatif pour les niveaux configurés est ${presentation.indicativePrice.value}.`);
  if (course.pricingMode !== 'ONE_TIME') lines.push('Le mode de tarification est celui publié au catalogue ; le chatbot ne lance aucun paiement.');
  return lines.join('\n');
}

function registrationLink(course, publicAppUrl) {
  if (!publicAppUrl) return null;
  try {
    const url = new URL(publicAppUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
  } catch { return null; }
  const base = String(publicAppUrl).replace(/\/+$/, '');
  if (course.session?.id) return `${base}/register?session=${encodeURIComponent(course.session.id)}`;
  if (course.id) return `${base}/register?course=${encodeURIComponent(course.id)}`;
  return null;
}

function createConversationEngine({
  catalog = publicCourseService,
  registration = registrationService,
  presentation = { buildPublicCoursePresentation },
  limits = { accessLimits },
  now = () => new Date(),
  whatsappConfig = () => getWhatsAppConfig(),
  chatbot = null,
  scenarios = null,
  admissions = null,
  env = process.env,
} = {}) {
  async function handleMessage({ text, interactionId = null, phoneNumber = null, messageId, state: rawState, publicAppUrl = '', allowCommercialFollowUpConsent = true } = {}) {
    let state = makeInitialState(rawState);
    const id = messageId == null ? '' : String(messageId);
    if (id && state.processedMessageIds.includes(id)) return { intent: 'DUPLICATE', duplicate: true, text: null, actions: [], state };
    if (!interactionId) state.preferredLanguage = require('./whatsappAdvisorPolicy').detectLanguage(text, state.preferredLanguage);

    let intent = detectIntent(interactionId ? '' : text);
    if (!interactionId && !['OPT_OUT','RESUME_AUTOMATION','COMMERCIAL_CONSENT_GRANT'].includes(intent)) {
      if (require('./whatsappCommercialResponder').identityInput(text,state.admission)) intent = 'UNKNOWN';
      else if (require('./whatsappCommercialIntents').isRefusal(text)) intent = 'REFUSAL';
    }
    if (state.admission?.step === 'EMAIL' && String(text).includes('@')) intent = 'UNKNOWN';
    if (!interactionId && intent !== 'UNKNOWN') state.scenarioMenu = null;
    if (intent === 'OPT_OUT') {
      const next = withMessageId({ ...state, admission: null, optedOut: true, automationPaused: true, lastIntent: intent, pendingQuestion: null, step: 'OPTED_OUT' }, id);
      return { intent, duplicate: false, text: null, actions: [{ type: 'OPT_OUT', source: 'WHATSAPP_INBOUND' }], state: next };
    }
    if (state.optedOut) return { intent: 'OPTED_OUT', duplicate: false, text: null, actions: [], state: withMessageId(state, id) };
    if (intent === 'COMMERCIAL_CONSENT_GRANT') {
      state.lastIntent = intent;
      if (state.commercialFollowUpsGranted && (!whatsappConfig().followUp48h || state.commercialConsentNoticeVersion === CONSENT_NOTICE_VERSION)) {
        return { intent: 'COMMERCIAL_CONSENT_ALREADY_GRANTED', duplicate: false, text: state.preferredLanguage === 'en' ? 'Your follow-up consent is already recorded. Reply STOP to withdraw.' : 'Votre accord pour la relance est déjà enregistré. Répondez STOP pour le retirer.', actions: [], state: withMessageId(state, id) };
      }
      if (!allowCommercialFollowUpConsent) {
        return { intent: 'COMMERCIAL_FOLLOW_UP_UNAVAILABLE', duplicate: false, text: 'Aucun accord n’est enregistré : ces relances commerciales sont réservées aux prospects non inscrits.', actions: [], state: withMessageId(state, id) };
      }
      const askedAt = state.commercialFollowUpConsentRequestedAt ? new Date(state.commercialFollowUpConsentRequestedAt) : null;
      const requestAge = askedAt ? now().getTime() - askedAt.getTime() : -1;
      const validRequest = !state.automationPaused && askedAt && !Number.isNaN(askedAt.getTime()) && requestAge >= 0 && requestAge <= CONSENT_REQUEST_TTL_MS
        && (!whatsappConfig().followUp48h || state.commercialConsentRequestedVersion === CONSENT_NOTICE_VERSION);
      if (!validRequest) {
        return { intent: 'COMMERCIAL_CONSENT_NOT_REQUESTED', duplicate: false, text: 'Je n’enregistre aucun accord sans demande de consentement en attente. Vous pouvez demander les informations souhaitées ou écrire « conseiller ». ', actions: [], state: withMessageId(state, id) };
      }
      return {
        intent, duplicate: false,
        text: state.preferredLanguage === 'en' ? 'Your consent to one NVA marketing follow-up after 48 hours of inactivity is recorded. Reply STOP at any time to withdraw.' : 'Votre accord pour une relance commerciale NVA après 48 h sans message est enregistré. Répondez STOP à tout moment pour le retirer.',
        actions: [{ type: 'COMMERCIAL_CONSENT_GRANT', scope: 'COMMERCIAL_FOLLOW_UPS', noticeVersion: CONSENT_NOTICE_VERSION }],
        state: withMessageId({ ...state, commercialFollowUpsGranted: true, commercialConsentNoticeVersion: CONSENT_NOTICE_VERSION, commercialFollowUpConsentRequestedAt: null }, id),
      };
    }
    if (intent === 'RESUME_AUTOMATION') {
      const next = withMessageId({ ...state, automationPaused: false, lastIntent: intent,
        step: state.pendingQuestion?.type === 'COURSE' ? 'SELECT_COURSE' : state.pendingQuestion?.type === 'TOPIC' ? 'SELECT_TOPIC' : state.selectedCourseId || state.selectedCourseSlug ? 'INFORMATION' : 'MENU' }, id);
      return { intent, duplicate: false, text: 'L’assistance automatique reprend. Que souhaitez-vous savoir ?', actions: [{ type: 'RESUME_AUTOMATION' }], state: next };
    }
    if (state.automationPaused) return { intent: 'PAUSED', duplicate: false, text: null, actions: [], state: withMessageId(state, id) };
    if (intent === 'HUMAN_HANDOFF') {
      const next = withMessageId({ ...state, automationPaused: true, lastIntent: intent, step: 'HUMAN_HANDOFF' }, id);
      return { intent, duplicate: false, text: 'Je transmets votre demande à un conseiller. Les réponses automatiques sont suspendues jusqu’à la reprise de l’assistance.', actions: [{ type: 'HUMAN_HANDOFF', context: { qualification: next.qualification, selectedCourseSlug: next.selectedCourseSlug } }], state: next };
    }

    try {
      if (state.mode === 'QUESTION_AI' && !interactionId) {
        const command = normalizeText(text);
        const registrationIntent = /\b(inscri\w*|inscris|register|registration|enrol\w*)\b|sign up/.test(command);
        const navigation = /^(menu|main menu|nos formations|formations|our courses|courses|m inscrire|annuler|cancel)$/.test(command);
        if (registrationIntent || navigation) {
          state = { ...state, mode: null, questionAIStartedAt: null, admission: null };
          if (registrationIntent) { text = 'Je veux m’inscrire'; intent = 'REGISTRATION'; }
          else if (/formations|courses/.test(command)) { text = 'formations'; intent = 'CATALOG'; }
          else { text = 'menu'; intent = 'MENU'; }
        } else if (env.NVA_AI_ENABLED === 'true') {
          const courses = await catalog.listPublished();
          const resolved = require('./whatsappCommercialPolicy').resolveCourse(text, courses, state);
          // A sole catalogue entry is not itself evidence of a prospect's interest.
          const interest = /\b(anglais|english|formation|course|apprendre|learn|niveau|level|prix|price|cost|tarif|essai|trial|horaire|schedule)\b/i.test(text);
          if (resolved.course && interest) state = { ...state, selectedCourseId: resolved.course.id, selectedCourseSlug: resolved.course.slug };
          if (/^(relances|follow ups|marketing consent)$/.test(command)) {
            const english = state.preferredLanguage === 'en';
            return { intent: 'COMMERCIAL_CONSENT_REQUEST', actions: [], text: english
              ? 'Would you like one optional NVA WhatsApp marketing follow-up after 48 hours without a message? Reply YES FOLLOW UPS to agree. Reply STOP at any time to withdraw.'
              : 'Souhaitez-vous une relance commerciale WhatsApp facultative de NVA après 48 h sans message ? Répondez OUI RELANCES pour accepter. STOP permet de retirer votre accord à tout moment.',
              state: withMessageId({ ...state, commercialFollowUpConsentRequestedAt: now().toISOString(), commercialConsentRequestedVersion: CONSENT_NOTICE_VERSION }, id) };
          }
          return { intent: 'QUESTION_AI', duplicate: false, text: require('./whatsappQuestionAIService').fallback(text,state.preferredLanguage),
            deferredQuestionAI: true, actions: [], state: withMessageId(state, id) };
        }
      }
      const admission = admissions ? await admissions.resolve({ text, interactionId, intent, state, phoneNumber, messageId: id }) : null;
      if (admission) return { ...admission, intent: 'ADMISSIONS', duplicate: false, state: withMessageId(admission.state, id) };
      const scenario = scenarios ? await scenarios.resolve({ text, interactionId, intent, state, prospect: allowCommercialFollowUpConsent }) : null;
      if (scenario?.catalogIntent) {
        state = { ...scenario.state, pendingQuestion: null };
        intent = scenario.catalogIntent;
        text = { CATALOG: 'formations', PRICE: 'prix', SCHEDULE: 'horaires', TRIAL: 'essai', REGISTRATION: 'inscription' }[intent];
      } else if (scenario) {
        return { ...scenario, intent: 'SCENARIO', duplicate: false, state: withMessageId(scenario.state, id) };
      } else if (interactionId) {
        return { intent: 'STALE_INTERACTION', duplicate: false, text: 'Ce choix n’est plus disponible. Écrivez « menu » pour recommencer.', actions: [], state: withMessageId({ ...state, scenarioMenu: null }, id) };
      }
      const configured = chatbot ? await chatbot.resolve({ text, intent, state, allowAI: false }) : null;
      if (configured) return { intent, duplicate: false, text: configured.text, actions: [], state: withMessageId({ ...state, lastIntent: intent }, id) };
      let reply;
      let deferredAI = false;
      let next = state;
      const topicIntents = ['PRICE', 'SCHEDULE', 'TRIAL', 'REGISTRATION'];
      const finishSelection = course => {
        next = { ...next, selectedCourseId: course.id || null, selectedCourseSlug: course.slug || null };
      };
      const askCourse = (courses, wantedIntent, prefix) => {
        next = { ...next, pendingQuestion: { type: 'COURSE', intent: wantedIntent || null }, step: 'SELECT_COURSE' };
        return `${prefix}\n${courses.slice(0, 8).map(course => `• ${course.title}`).join('\n')}\nRépondez avec le nom de la formation, ou « menu ».`;
      };
      const topicPrompt = course => {
        finishSelection(course);
        next = { ...next, pendingQuestion: { type: 'TOPIC', intent: null }, step: 'SELECT_TOPIC' };
        return `Vous avez choisi ${course.title}. Souhaitez-vous connaître le tarif, les horaires, les conditions d’essai ou les modalités d’inscription ?`;
      };
      if (['MENU', 'GREETING', 'CANCEL_REQUEST'].includes(intent)) {
        next = { ...next, selectedCourseId: null, selectedCourseSlug: null, pendingQuestion: null, step: 'MENU' };
        reply = `${intent === 'CANCEL_REQUEST' ? 'La demande en cours est annulée. ' : ''}Menu NVA : formations, prix, horaires, essai, inscription ou conseiller.`;
      } else if (intent === 'CHANGE_COURSE') {
        const courses = await catalog.listPublished();
        next = { ...next, selectedCourseId: null, selectedCourseSlug: null, pendingQuestion: null, step: 'MENU' };
        reply = courses.length ? askCourse(courses, null, 'Quelle autre formation souhaitez-vous choisir ?') : courseListReply(courses);
      } else if (intent === 'AMBIGUOUS') {
        next = { ...next, pendingQuestion: { type: 'TOPIC', intent: null }, step: 'SELECT_TOPIC' };
        const courses = await catalog.listPublished();
        const named = matchCourse(text, courses);
        if (named) finishSelection(named);
        reply = 'Je peux vous aider sur ces sujets. Souhaitez-vous d’abord connaître les formations, les tarifs, les horaires, l’essai ou l’inscription ?';
      } else if (intent === 'OBJECTION') {
        reply = 'Je comprends. Je peux vérifier le tarif ou les horaires exacts d’une formation, ou transmettre votre question à un conseiller. Qu’est-ce qui vous aiderait le plus ?';
      } else {
        if (intent === 'QUALIFICATION') {
          next = { ...next, qualification: { ...next.qualification, objective: String(text || '').trim().slice(0, 240) } };
        }
        const wanted = topicIntents.includes(intent) ? intent
          : (intent === 'UNKNOWN' || (intent === 'CATALOG' && courseQuery(text).length)) && state.pendingQuestion?.type === 'COURSE' ? state.pendingQuestion.intent : null;
        const published = await catalog.listPublished();
        const openCourses = wanted && wanted !== 'PRICE' ? await registration.listCoursesForPublicRegistration() : [];
        const courses = [...published, ...openCourses.filter(course => !published.some(other => other.id === course.id))];
        const matches = matchCourses(text, courses);
        const selectedInState = courses.find(course => state.selectedCourseId ? course.id === state.selectedCourseId : state.selectedCourseSlug && course.slug === state.selectedCourseSlug);
        if ((state.selectedCourseId || state.selectedCourseSlug) && !selectedInState) next = { ...next, selectedCourseId: null, selectedCourseSlug: null };
        // An explicit unknown or ambiguous course never falls back to another course.
        let selected = matches.length === 1 ? matches[0] : null;
        if (!selected && !matches.length && wanted && !courseQuery(text).length && state.pendingQuestion?.type !== 'COURSE') selected = selectedInState;
        if (!selected && !matches.length && wanted && wanted !== 'PRICE' && !courseQuery(text).length
          && state.pendingQuestion?.type !== 'COURSE' && !state.selectedCourseId && !state.selectedCourseSlug && openCourses.length === 1) selected = openCourses[0];
        const unknownCourse = wanted && !selected && courseQuery(text).length > 0 && !matches.length;
        if (matches.length > 1) {
          reply = askCourse(matches, wanted, 'Plusieurs formations correspondent. Laquelle souhaitez-vous choisir ?');
        } else if (selected && wanted) {
          intent = wanted;
          finishSelection(selected);
          next = { ...next, pendingQuestion: null, step: wanted === 'REGISTRATION' ? 'REGISTRATION' : 'INFORMATION' };
          if (wanted === 'PRICE') reply = courseDetailsForPrice(selected, presentation.buildPublicCoursePresentation, now());
          else {
            const available = openCourses.find(course => course.id === selected.id || (selected.slug && course.slug === selected.slug));
            if (!available?.session) {
              reply = wanted === 'TRIAL'
                ? `Je ne trouve pas de session ouverte pour ${selected.title}. Les conditions d’essai doivent être vérifiées avec un conseiller.`
                : `Aucune session ouverte à l’inscription n’est disponible pour ${selected.title} actuellement. Écrivez « conseiller » pour connaître les prochaines possibilités.`;
            } else if (wanted === 'SCHEDULE') reply = scheduleReply(available);
            else if (wanted === 'TRIAL') {
              const trialLimit = limits.accessLimits(available).trial;
              reply = trialLimit > 0
                ? `Pour ${available.title}, les règles actuelles prévoient jusqu’à ${trialLimit} séances d’essai avant le seuil de paiement prévu par cette formation. L’accès nécessite d’abord de suivre le parcours d’inscription officiel.`
                : `Pour ${available.title}, les règles actuelles ne prévoient pas de séances d’essai avant paiement. Un conseiller peut vous expliquer les modalités publiées.`;
            } else {
              const link = registrationLink(available, publicAppUrl);
              reply = link
                ? `Pour poursuivre l’inscription à ${available.title}, utilisez le formulaire officiel : ${link} Le formulaire confirmera la disponibilité et recueillera les informations nécessaires.`
                : `La formation ${available.title} est disponible, mais le lien officiel n’est pas configuré dans ce moteur. Écrivez « conseiller » pour obtenir de l’aide.`;
            }
          }
        } else if (selected) {
          intent = 'COURSE_SELECTION';
          reply = topicPrompt(selected);
        } else if (wanted) {
          const question = { PRICE: 'Pour quel cours souhaitez-vous connaître le tarif ?', SCHEDULE: 'Pour quel cours souhaitez-vous les horaires ?', TRIAL: 'Pour quelle formation souhaitez-vous connaître les conditions d’essai ?', REGISTRATION: 'Quelle formation souhaitez-vous choisir ?' }[wanted];
          const prefix = unknownCourse ? `Je ne trouve pas cette formation dans les informations publiques. ${question}`
            : (state.selectedCourseId || state.selectedCourseSlug) && !selectedInState ? `La formation sélectionnée n’est plus disponible dans les informations publiques. ${question}` : question;
          reply = courses.length ? askCourse(courses, wanted, prefix) : 'Aucune formation publiée n’est disponible actuellement. Un conseiller peut vous renseigner.';
          if (!courses.length) next = { ...next, pendingQuestion: null, step: 'MENU' };
        } else if (['CATALOG', 'QUALIFICATION'].includes(intent)) {
          reply = courseListReply(published);
          next = { ...next, pendingQuestion: published.length ? { type: 'COURSE', intent: null } : null, step: published.length ? 'SELECT_COURSE' : 'MENU' };
        } else {
          reply = state.pendingQuestion?.type === 'COURSE' && published.length
            ? askCourse(published, state.pendingQuestion.intent, 'Je ne trouve pas cette formation. Précisez son nom parmi les formations publiées :')
            : UNKNOWN_REPLY;
          if (state.pendingQuestion?.type === 'COURSE' && !published.length) {
            reply = courseListReply(published);
            next = { ...next, pendingQuestion: null, step: 'MENU' };
          }
        }
      }
      // A first unrecognized contact gets the existing official menu, after
      // explicit topics, course selections, scenarios and configured rules.
      if (admissions && intent === 'UNKNOWN' && reply === UNKNOWN_REPLY
        && !state.processedMessageIds.length && !state.lastIntent
        && !state.admission && !state.scenarioMenu && !state.pendingQuestion
        && !state.selectedCourseId && !state.selectedCourseSlug) {
        const welcome = await admissions.resolve({ text: 'menu', intent: 'MENU', state, phoneNumber, messageId: id });
        if (welcome) return { ...welcome, intent: 'ADMISSIONS', duplicate: false, state: withMessageId(welcome.state, id) };
      }
      if (chatbot && intent === 'UNKNOWN' && reply === UNKNOWN_REPLY) {
        const deterministic = admissions?.resolveUnknown ? await admissions.resolveUnknown({ state }) : null;
        if (deterministic) return { ...deterministic, intent: 'UNKNOWN', duplicate: false, state: withMessageId(deterministic.state, id) };
        const fallback = await chatbot.resolve({ text, intent, state, allowAI: true });
        if (fallback) { reply = fallback.text; deferredAI = fallback.deferredAI === true; }
      }
      if (!chatbot && intent === 'UNKNOWN' && reply === UNKNOWN_REPLY && admissions?.resolveUnknown) {
        const deterministic = await admissions.resolveUnknown({ state });
        if (deterministic) return { ...deterministic, intent: 'UNKNOWN', duplicate: false, state: withMessageId(deterministic.state, id) };
      }
      next = { ...next, lastIntent: intent === 'UNKNOWN' ? state.lastIntent : intent };
      const followUpConfig = whatsappConfig();
      const templatesConfigured = followUpConfig.followUp48h || Boolean(followUpConfig.prospectFollowUp24hTemplate && followUpConfig.prospectFollowUp72hTemplate);
      const mayAskConsent = allowCommercialFollowUpConsent && templatesConfigured
        && ['CATALOG', 'PRICE', 'SCHEDULE', 'TRIAL', 'REGISTRATION', 'OBJECTION', 'QUALIFICATION'].includes(intent)
        && (!state.commercialFollowUpsGranted || state.commercialConsentNoticeVersion !== CONSENT_NOTICE_VERSION) && !state.commercialFollowUpConsentRequestedAt;
      if (mayAskConsent) {
        reply = `${reply}\n\n${COMMERCIAL_FOLLOW_UP_INVITATION}`;
        next = { ...next, commercialFollowUpConsentRequestedAt: now().toISOString(), commercialConsentRequestedVersion: CONSENT_NOTICE_VERSION };
      }
      return { intent, duplicate: false, text: reply, actions: [], ...(deferredAI ? { deferredAI: true } : {}), state: withMessageId(next, id) };
    } catch {
      return { intent, duplicate: false, text: TEMPORARY_ERROR_REPLY, actions: [{ type: 'TEMPORARY_ERROR' }], retryable: true, state };
    }
  }

  return { handleMessage };
}

module.exports = {
  MAX_PROCESSED_MESSAGE_IDS,
  CONSENT_REQUEST_TTL_MS,
  CONSENT_NOTICE_VERSION,
  COMMERCIAL_FOLLOW_UP_INVITATION,
  UNKNOWN_REPLY,
  TEMPORARY_ERROR_REPLY,
  normalizeText,
  detectIntent,
  makeInitialState,
  matchCourse,
  matchCourses,
  createConversationEngine,
};
