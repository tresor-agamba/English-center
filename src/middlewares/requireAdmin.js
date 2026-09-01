function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'ADMIN') {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    return next(error);
  }
  res.locals = res.locals || {};
  res.locals.layoutContext = 'admin';
  const requestPath = req.originalUrl || req.url || req.path || '/admin/dashboard';
  res.locals.adminNavigationPath = requestPath.split('?')[0].replace(/^\/admin/, '') || '/dashboard';
  res.locals.adminNavigationUser = req.session.user;
  return next();
}

module.exports = requireAdmin;
