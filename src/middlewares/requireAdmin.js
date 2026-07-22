function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'ADMIN') {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    return next(error);
  }
  return next();
}

module.exports = requireAdmin;
