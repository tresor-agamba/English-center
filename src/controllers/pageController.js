const publicCourseService = require('../services/publicCourseService');
const { formatCourseType, formatDuration } = require('../utils/catalogFormat.util');
const { buildPublicCourseCard } = require('../utils/publicCoursePresentation.util');

async function showHome(req, res) {
  const [courses, upcomingSessions] = await Promise.all([
    publicCourseService.listPublished(),
    publicCourseService.listUpcomingSessions(3),
  ]);
  res.render('home', {
    title: 'Home',
    courses: courses.slice(0, 3),
    courseCards: courses.slice(0, 3).map(buildPublicCourseCard),
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

module.exports = { showHome, showAbout, showContact, buildHomeCourseCard: buildPublicCourseCard };
