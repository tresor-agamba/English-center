const { formatCourseType, formatDuration } = require('./catalogFormat.util');
const { courseTotals } = require('../services/courseStructureService');

const COURSE_TYPE_I18N = {
  GENERAL_ENGLISH: 'course.type.generalEnglish',
  BUSINESS_ENGLISH: 'course.type.businessEnglish',
  ENGLISH_FOR_BANKERS: 'course.type.englishForBankers',
  CONVERSATION: 'course.type.conversation',
  IELTS_PREPARATION: 'course.type.ieltsPreparation',
  BEGINNER_ENGLISH: 'course.type.beginnerEnglish',
};

function buildPublicCoursePresentation(course) {
  const totals = courseTotals(course);
  const currency = course.currency || 'USD';
  const durationFact = (value, perLevel = false) => ({
    label: perLevel ? 'Durée par niveau' : 'Durée',
    labelKey: perLevel ? 'structure.durationPerLevel' : 'course.fact.duration',
    value: formatDuration({ ...course, durationValue: value }) || 'Durée à préciser',
    durationValue: value, durationUnit: course.durationUnit, perLevel,
  });
  const sessionsFact = (value, perLevel = false) => ({
    label: perLevel ? 'Séances par niveau' : 'Séances',
    labelKey: perLevel ? 'structure.sessionsPerLevel' : 'structure.sessions',
    value: String(value), unitKey: 'structure.sessions', unit: 'séances', perLevel,
  });
  const priceFact = (amount, indicative = false) => ({
    label: indicative ? 'Prix total indicatif' : (totals.levelBased ? 'Prix par niveau' : 'Tarif'),
    labelKey: indicative ? 'structure.totalPrice' : (totals.levelBased ? 'structure.pricePerLevel' : 'course.fact.price'),
    value: `${Number(amount)} ${currency}`, amount: Number(amount), currency,
    perLevel: totals.levelBased && !indicative,
  });
  const duration = durationFact(totals.totalDuration);
  const programmeFacts = [];
  if (totals.levelBased) programmeFacts.push({ label: 'Niveaux', labelKey: 'structure.levels', value: String(totals.numberOfLevels), unitKey: 'structure.levels', unit: 'niveaux' });
  if (totals.totalSessions != null) programmeFacts.push(sessionsFact(totals.totalSessions));
  programmeFacts.push(duration);
  const price = course.pricingActive && course.price != null ? priceFact(course.price) : null;
  const perLevelFacts = totals.levelBased ? [durationFact(totals.durationPerLevel, true), sessionsFact(totals.sessionsPerLevel, true)] : [];
  return {
    totals, programmeFacts, duration, price, perLevelFacts,
    indicativePrice: totals.levelBased && price ? priceFact(totals.totalIndicativePrice, true) : null,
    levelPreviews: totals.levelBased ? Array.from({ length: Math.min(totals.numberOfLevels, 20) }, (_, i) => i + 1) : [],
    hasMoreLevels: totals.levelBased && totals.numberOfLevels > 20,
  };
}

function buildPublicCourseCard(course) {
  const presentation = buildPublicCoursePresentation(course);
  const { totals } = presentation;
  const canRegister = course.upcomingSessionCount > 0;
  const hasPlannedSession = !canRegister && Boolean(course.nextPlannedSessionStart);
  const status = canRegister ? 'open' : (hasPlannedSession ? 'soon' : 'closed');
  const categoryLabel = formatCourseType(course.courseType) || 'Catégorie à préciser';
  const isGeneralEnglish = course.courseType === 'GENERAL_ENGLISH';
  const facts = [
    ...presentation.programmeFacts,
    { label: 'Mode', labelKey: 'course.fact.mode', value: course.trainingMode || 'Mode à préciser', valueKey: /en ligne|online/i.test(course.trainingMode || '') ? 'course.mode.online' : null },
    { label: 'Session', labelKey: 'course.fact.session', value: canRegister ? 'Session ouverte' : (hasPlannedSession ? 'Bientôt disponible' : 'Aucune session ouverte'), valueKey: `course.status.${status}` },
  ];
  if (presentation.price) facts.push(presentation.price);
  facts.push(...presentation.perLevelFacts);
  return {
    id: course.id, slug: course.slug, title: course.title, course, totals, presentation,
    description: course.shortDescription || course.description || 'Les informations détaillées seront publiées prochainement.',
    category: course.courseType || 'OTHER', categoryLabel,
    categoryKey: COURSE_TYPE_I18N[course.courseType] || 'fallback.category',
    searchText: `${course.title} ${categoryLabel} ${course.level || ''}`.toLocaleLowerCase('fr'),
    status, statusLabel: canRegister ? 'Inscriptions ouvertes' : (hasPlannedSession ? 'Bientôt disponible' : 'Aucune session ouverte'),
    statusKey: `course.status.${status}`, canRegister, facts,
    imageSrc: isGeneralEnglish ? '/images/nva/pic-5.jpeg' : '/images/public/course-online-learning.jpg',
    imageAlt: isGeneralEnglish ? "Apprenante participant à une formation d'anglais en ligne New Vision Academy" : '',
    detailsLabel: 'Voir la formation', registerLabel: "S'inscrire",
  };
}

module.exports = { COURSE_TYPE_I18N, buildPublicCourseCard, buildPublicCoursePresentation, courseTotals };
