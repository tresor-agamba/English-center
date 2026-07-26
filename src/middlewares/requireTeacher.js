const prisma = require('../utils/prisma');

module.exports = async function requireTeacher(req, res, next) {
  const sessionUser = req.session?.user;
  if (!sessionUser) return res.redirect(`/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
  if (sessionUser.role !== 'TEACHER') {
    return res.status(403).render('error', { title: 'Accès refusé', message: 'Cet espace est réservé aux enseignants.' });
  }
  try {
    const teacher = await prisma.user.findFirst({
      where: { id: sessionUser.id, role: 'TEACHER', isActive: true },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true, role: true, isActive: true },
    });
    if (!teacher) {
      return req.session.destroy(() => res.status(403).render('error', {
        title: 'Compte indisponible', message: 'Votre compte enseignant est inactif ou introuvable.',
      }));
    }
    req.teacher = teacher;
    res.locals.currentUser = teacher;
    return next();
  } catch (error) {
    return next(error);
  }
};
