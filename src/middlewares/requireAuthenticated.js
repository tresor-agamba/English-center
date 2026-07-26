module.exports = (req, res, next) => {
  if (req.session?.user) return next();
  const sessionId = Number(req.query.session || req.body?.sessionId);
  const target = Number.isInteger(sessionId) && sessionId > 0 ? `/login?session=${sessionId}` : '/login';
  return res.redirect(target);
};
