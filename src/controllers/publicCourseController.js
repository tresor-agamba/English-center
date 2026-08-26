const publicCourseService = require('../services/publicCourseService');
const { formatCourseType, formatDuration, formatWeekDays } = require('../utils/catalogFormat.util');
const { buildPublicCourseCard } = require('../utils/publicCoursePresentation.util');

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
      message: 'La formation demandée est introuvable.',
    });
  }

  const course = await publicCourseService.findPublishedBySlug(slug);
  if (!course) {
    return res.status(404).render('error', {
      title: 'Formation introuvable',
      message: 'La formation demandée est introuvable.',
    });
  }

  return res.render('public/courses/show', {
    title: course.title,
    course,
    formatCourseType,
    formatDuration,
    formatWeekDays,
  });
}

module.exports = { index, show };
