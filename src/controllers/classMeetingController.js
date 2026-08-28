const trialAccessService = require('../services/trialAccessService');

async function join(req, res) {
  try {
    const access = await trialAccessService.canAccessClassMeeting(
      req.session.user.id,
      Number(req.query.enrollment),
      Number(req.params.id)
    );
    if (!access.allowed) {
      const paymentMessage = access.trialAccess.accessStage === 'PAYMENT_REQUIRED_FULL'
        ? 'Vous avez terminé les 10 premières séances autorisées. Veuillez payer le solde restant pour accéder aux 6 dernières séances du niveau.'
        : 'Votre période gratuite de 5 séances est terminée. Vous devez payer au moins 50 % du prix total pour accéder aux 5 séances suivantes.';
      return res.status(403).render('student/enrollment/unavailable', {
        title: 'Accès au cours bloqué',
        message: paymentMessage,
        access: access.trialAccess,
        layoutContext: 'student',
      });
    }
    return res.redirect(access.meeting.privateMeetingUrl);
  } catch (error) {
    if (error instanceof trialAccessService.TrialAccessError) {
      return res.status(error.statusCode || 400).render('student/enrollment/unavailable', {
        title: 'Accès au cours indisponible',
        message: error.message,
        layoutContext: 'student',
      });
    }
    throw error;
  }
}

module.exports = { join };
