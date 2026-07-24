const publicCourseService = require('../services/publicCourseService');

async function index(req, res) {
  const courses = await publicCourseService.listPublished();
  return res.render('public/courses/index', {
    title: 'Nos formations',
    courses,
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
  });
}

module.exports = { index, show };
