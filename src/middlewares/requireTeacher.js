module.exports = function requireTeacher(req, res, next) {
  if (!req.session?.user) return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  const teacher = req.authenticatedUser;
  if (!teacher || teacher.role !== 'TEACHER' || !teacher.isActive) {
    return res.status(403).render('error', { title: 'Accès refusé', message: 'Cet espace est réservé aux enseignants.' });
  }
  if (teacher.mustChangePassword) return res.redirect('/change-password');
  req.teacher = teacher;
  res.locals.currentUser = teacher;
  return next();
};
