function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (!req.authenticatedUser || req.authenticatedUser.role !== 'ADMIN' || !req.authenticatedUser.isActive) {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    return next(error);
  }
  if (req.authenticatedUser.mustChangePassword) return res.redirect('/change-password');
  res.locals = res.locals || {};
  res.locals.layoutContext = 'admin';
  const requestPath = req.originalUrl || req.url || req.path || '/admin/dashboard';
  res.locals.adminNavigationPath = requestPath.split('?')[0].replace(/^\/admin/, '') || '/dashboard';
  res.locals.adminNavigationUser = req.authenticatedUser;
  return next();
}

module.exports = requireAdmin;
