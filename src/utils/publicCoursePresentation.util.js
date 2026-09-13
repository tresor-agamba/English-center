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

function buildPublicCourseCard(course) {
  const totals = courseTotals(course);
  const canRegister = course.upcomingSessionCount > 0;
  const hasPlannedSession = !canRegister && Boolean(course.nextPlannedSessionStart);
  const status = canRegister ? 'open' : (hasPlannedSession ? 'soon' : 'closed');
  const categoryLabel = formatCourseType(course.courseType) || 'Catégorie à préciser';
  const isGeneralEnglish = course.courseType === 'GENERAL_ENGLISH';
  const facts = [
    { label: totals.levelBased ? 'Durée par niveau' : 'Durée', labelKey: totals.levelBased ? 'structure.durationPerLevel' : 'course.fact.duration', value: formatDuration(course) || 'Durée à préciser', durationValue: course.durationValue || null, durationUnit: course.durationUnit || null },
    { label: 'Mode', labelKey: 'course.fact.mode', value: course.trainingMode || 'Mode à préciser', valueKey: /en ligne|online/i.test(course.trainingMode || '') ? 'course.mode.online' : null },
    { label: 'Session', labelKey: 'course.fact.session', value: canRegister ? 'Session ouverte' : (hasPlannedSession ? 'Bientôt disponible' : 'Aucune session ouverte'), valueKey: `course.status.${status}` },
  ];
  if (course.pricingActive && course.price !== null && course.price !== undefined) {
    facts.push({ label: totals.levelBased ? 'Prix par niveau' : 'Prix', labelKey: totals.levelBased ? 'structure.pricePerLevel' : 'course.fact.price', value: String(course.price), amount: Number(course.price), currency: course.currency || 'USD' });
  }
  if (course.sessionCount) facts.push({ label: totals.levelBased ? 'Séances par niveau' : 'Séances', labelKey: totals.levelBased ? 'structure.sessionsPerLevel' : 'structure.sessions', value: String(course.sessionCount) });
  return {
    id: course.id, slug: course.slug, title: course.title, course, totals,
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

module.exports = { COURSE_TYPE_I18N, buildPublicCourseCard, courseTotals };
