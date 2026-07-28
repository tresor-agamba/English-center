const publicCourseService = require('../services/publicCourseService');
const { formatCourseType, formatDuration } = require('../utils/catalogFormat.util');

async function showHome(req, res) {
  const courses = await publicCourseService.listPublished();
  res.render('home', { title: 'Home', courses: courses.slice(0, 3), formatCourseType, formatDuration });
}

module.exports = { showHome };
