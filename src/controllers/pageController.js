const publicCourseService = require('../services/publicCourseService');
const { formatCourseType, formatDuration } = require('../utils/catalogFormat.util');

function formatPublicPrice(course) {
  if (!course.pricingActive || course.price === null || course.price === undefined) return null;
  const amount = Number(course.price);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: course.currency || 'USD', maximumFractionDigits: 2,
  }).format(amount);
}

function buildHomeCourseCard(course) {
  const canRegister = course.upcomingSessionCount > 0;
  const categoryLabel = formatCourseType(course.courseType) || 'Catégorie à préciser';
  const priceLabel = formatPublicPrice(course);
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.shortDescription || course.description || 'Les informations détaillées seront publiées prochainement.',
    category: course.courseType || 'OTHER',
    categoryLabel,
    searchText: `${course.title} ${categoryLabel}`.toLocaleLowerCase('fr'),
    status: canRegister ? 'open' : 'closed',
    statusLabel: canRegister ? 'Inscriptions ouvertes' : 'Aucune session ouverte',
    canRegister,
    detailsLabel: 'Voir la formation',
    registerLabel: "S'inscrire",
    facts: [
      { label: 'Durée', value: formatDuration(course) || 'Durée à préciser' },
      { label: 'Mode', value: course.trainingMode || 'Mode à préciser' },
      { label: 'Session', value: canRegister ? 'Session ouverte' : 'Aucune session ouverte' },
      ...(priceLabel ? [{ label: 'Prix', value: priceLabel }] : []),
    ],
  };
}

async function showHome(req, res) {
  const [courses, upcomingSessions] = await Promise.all([
    publicCourseService.listPublished(),
    publicCourseService.listUpcomingSessions(3),
  ]);
  res.render('home', {
    title: 'Home',
    courses: courses.slice(0, 3),
    courseCards: courses.slice(0, 3).map(buildHomeCourseCard),
    upcomingSessions,
    formatCourseType,
    formatDuration,
  });
}

function showAbout(req, res) {
  res.render('public/about', { title: 'About' });
}

function showContact(req, res) {
  res.render('public/contact', { title: 'Contact' });
}

module.exports = { showHome, showAbout, showContact, buildHomeCourseCard };
