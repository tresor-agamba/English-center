function safeSessionId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requireAuthenticated(req, res, next) {
  if (req.session.user) return next();
  const sessionId = safeSessionId(req.query.session || req.body.sessionId);
  return res.redirect(sessionId ? `/login?session=${sessionId}` : '/login');
}

module.exports = requireAuthenticated;
