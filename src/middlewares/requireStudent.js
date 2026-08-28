const prisma = require('../utils/prisma');

async function requireStudent(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'STUDENT') {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    return next(error);
  }
  if (req.session.user.mustChangePassword) return res.redirect('/change-password');

  try {
    const student = await prisma.user.findFirst({
      where: { id: req.session.user.id, role: 'STUDENT', isActive: true },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true, role: true, mustChangePassword: true },
    });
    if (!student) {
      return req.session.destroy(() => res.redirect('/login'));
    }
    if (student.mustChangePassword) {
      req.session.user.mustChangePassword = true;
      return res.redirect('/change-password');
    }
    req.student = student;
    res.locals.layoutContext = 'student';
    res.locals.studentNavigationUser = student;
    res.locals.studentNavigationPath = req.originalUrl.split('?')[0];
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = requireStudent;
