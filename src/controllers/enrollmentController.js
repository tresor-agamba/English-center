const registrationService = require('../services/registrationService');

function renderUnavailable(res, error) {
  return res.status(error.statusCode || 400).render('student/enrollment/unavailable', {
    title: 'Inscription indisponible',
    message: error.message || 'Cette session ne permet plus les inscriptions.',
  });
}

async function confirm(req, res) {
  try {
    const intent = await registrationService.getEnrollmentIntent(req.session.user.id, req.query.session);
    if (intent.existingEnrollment) {
      return res.redirect(`/registration/success/${intent.existingEnrollment.id}`);
    }
    return res.render('student/enrollment/confirm', {
      title: 'Confirmer mon inscription',
      session: intent.session,
    });
  } catch (error) {
    if (error instanceof registrationService.RegistrationError) return renderUnavailable(res, error);
    throw error;
  }
}

async function create(req, res) {
  try {
    const result = await registrationService.enrollExistingStudent({
      userId: req.session.user.id,
      sessionId: req.body.sessionId,
    });
    return res.redirect(`/registration/success/${result.enrollment.id}`);
  } catch (error) {
    if (error instanceof registrationService.RegistrationError) return renderUnavailable(res, error);
    throw error;
  }
}

module.exports = { confirm, create };
