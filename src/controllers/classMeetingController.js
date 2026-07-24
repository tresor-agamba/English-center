const trialAccessService = require('../services/trialAccessService');

async function join(req, res) {
  try {
    const access = await trialAccessService.canAccessClassMeeting(
      req.session.user.id,
      Number(req.query.enrollment),
      Number(req.params.id)
    );
    if (!access.allowed) {
      return res.status(403).render('student/enrollment/unavailable', {
        title: 'Accès au cours bloqué',
        message: 'Vos trois séances gratuites sont terminées. Confirmez votre paiement pour continuer.',
      });
    }
    return res.redirect(access.meeting.privateMeetingUrl);
  } catch (error) {
    if (error instanceof trialAccessService.TrialAccessError) {
      return res.status(error.statusCode || 400).render('student/enrollment/unavailable', {
        title: 'Accès au cours indisponible',
        message: error.message,
      });
    }
    throw error;
  }
}

module.exports = { join };
