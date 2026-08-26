const { formatCourseType, formatDuration } = require('./catalogFormat.util');

const COURSE_TYPE_I18N = {
  GENERAL_ENGLISH: 'course.type.generalEnglish',
  BUSINESS_ENGLISH: 'course.type.businessEnglish',
  ENGLISH_FOR_BANKERS: 'course.type.englishForBankers',
  CONVERSATION: 'course.type.conversation',
  IELTS_PREPARATION: 'course.type.ieltsPreparation',
  BEGINNER_ENGLISH: 'course.type.beginnerEnglish',
};

function buildPublicCourseCard(course) {
  const canRegister = course.upcomingSessionCount > 0;
  const hasPlannedSession = !canRegister && Boolean(course.nextPlannedSessionStart);
  const status = canRegister ? 'open' : (hasPlannedSession ? 'soon' : 'closed');
  const categoryLabel = formatCourseType(course.courseType) || 'Catégorie à préciser';
  const facts = [
    { label: 'Durée', labelKey: 'course.fact.duration', value: formatDuration(course) || 'Durée à préciser', durationValue: course.durationValue || null, durationUnit: course.durationUnit || null },
    { label: 'Mode', labelKey: 'course.fact.mode', value: course.trainingMode || 'Mode à préciser', valueKey: /en ligne|online/i.test(course.trainingMode || '') ? 'course.mode.online' : null },
    { label: 'Session', labelKey: 'course.fact.session', value: canRegister ? 'Session ouverte' : (hasPlannedSession ? 'Bientôt disponible' : 'Aucune session ouverte'), valueKey: `course.status.${status}` },
  ];
  if (course.pricingActive && course.price !== null && course.price !== undefined) {
    facts.push({ label: 'Prix', labelKey: 'course.fact.price', value: String(course.price), amount: Number(course.price), currency: course.currency || 'USD' });
  }
  return {
    id: course.id, slug: course.slug, title: course.title,
    description: course.shortDescription || course.description || 'Les informations détaillées seront publiées prochainement.',
    category: course.courseType || 'OTHER', categoryLabel,
    categoryKey: COURSE_TYPE_I18N[course.courseType] || 'fallback.category',
    searchText: `${course.title} ${categoryLabel} ${course.level || ''}`.toLocaleLowerCase('fr'),
    status, statusLabel: canRegister ? 'Inscriptions ouvertes' : (hasPlannedSession ? 'Bientôt disponible' : 'Aucune session ouverte'),
    statusKey: `course.status.${status}`, canRegister, facts,
    detailsLabel: 'Voir la formation', registerLabel: "S'inscrire",
  };
}

module.exports = { COURSE_TYPE_I18N, buildPublicCourseCard };
