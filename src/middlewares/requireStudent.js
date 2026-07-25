const prisma = require('../utils/prisma');

async function requireStudent(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'STUDENT') {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    return next(error);
  }

  try {
    const student = await prisma.user.findFirst({
      where: { id: req.session.user.id, role: 'STUDENT', isActive: true },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true, role: true },
    });
    if (!student) {
      return req.session.destroy(() => res.redirect('/login'));
    }
    req.student = student;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireStudent;
