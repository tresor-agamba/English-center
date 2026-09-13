function requireStudent(req, res, next) {
  if (!req.session?.user) return res.redirect('/login');
  const student = req.authenticatedUser;
  if (!student || student.role !== 'STUDENT' || !student.isActive) {
    return next(Object.assign(new Error('Accès interdit.'), { statusCode: 403 }));
  }
  if (student.mustChangePassword) return res.redirect('/change-password');
  req.student = student;
  res.locals.layoutContext = 'student';
  res.locals.studentNavigationUser = student;
  res.locals.studentNavigationPath = req.originalUrl.split('?')[0];
  return next();
}
module.exports = requireStudent;
