const prisma = require('../utils/prisma');

const sessionUserSelect = {
  id: true, firstName: true, lastName: true, phoneNumber: true,
  role: true, isActive: true, mustChangePassword: true, authVersion: true,
};

function sessionUser(user) {
  return {
    id: user.id, firstName: user.firstName, lastName: user.lastName,
    phoneNumber: user.phoneNumber, role: user.role,
    mustChangePassword: user.mustChangePassword, authVersion: user.authVersion,
  };
}

function endSession(req, res, next, target = '/login') {
  return req.session.destroy((error) => {
    res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    if (error) return next(error);
    return res.redirect(target);
  });
}

async function validateSession(req, res, next) {
  const saved = req.session?.user;
  if (!saved) return next();
  if (!Number.isInteger(saved.id) || saved.id <= 0 || !Number.isInteger(saved.authVersion) || saved.authVersion < 0) {
    return endSession(req, res, next);
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: saved.id }, select: sessionUserSelect });
    if (!user || !user.isActive || user.authVersion !== saved.authVersion || user.role !== saved.role) {
      return endSession(req, res, next);
    }
    req.authenticatedUser = user;
    req.session.user = sessionUser(user);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = validateSession;
module.exports.sessionUser = sessionUser;
module.exports.endSession = endSession;
