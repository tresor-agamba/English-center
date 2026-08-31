const publicCourseService = require('../services/publicCourseService');
const { formatCourseType, formatDuration, formatWeekDays } = require('../utils/catalogFormat.util');
const { buildPublicCourseCard } = require('../utils/publicCoursePresentation.util');
const { publicMetadata } = require('../services/seoService');

async function index(req, res) {
  const courses = await publicCourseService.listPublished();
  const courseCards = courses.map(buildPublicCourseCard);
  const categories = [...new Map(courseCards.map((card) => [card.category, {
    value: card.category, label: card.categoryLabel, labelKey: card.categoryKey,
  }])).values()];
  return res.render('public/courses/index', {
    title: 'Nos formations',
    courses,
    courseCards,
    categories,
    formatCourseType,
    formatDuration,
  });
}

async function show(req, res) {
  const slug = req.params.slug;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) {
    return res.status(404).render('error', {
      title: 'Formation introuvable',
      seo: { ...(res.locals?.seo || {}), pageTitle: 'Formation introuvable | New Vision Academy', robotsMeta: 'noindex, nofollow' },
      message: 'La formation demandée est introuvable.',
    });
  }

  const course = await publicCourseService.findPublishedBySlug(slug);
  if (!course) {
    return res.status(404).render('error', {
      title: 'Formation introuvable',
      seo: { ...(res.locals?.seo || {}), pageTitle: 'Formation introuvable | New Vision Academy', robotsMeta: 'noindex, nofollow' },
      message: 'La formation demandée est introuvable.',
    });
  }

  return res.render('public/courses/show', {
    title: course.title,
    course,
    formatCourseType,
    formatDuration,
    formatWeekDays,
    seo: publicMetadata(req, {
      title: `${course.title} | New Vision Academy`,
      description: String(course.shortDescription || course.description || `Discover ${course.title} at New Vision Academy.`).replace(/\s+/g, ' ').trim().slice(0, 200),
      path: `/formations/${course.slug}`,
    }),
  });
}

module.exports = { index, show };
