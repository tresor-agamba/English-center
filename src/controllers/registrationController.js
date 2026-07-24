const bcrypt = require('bcrypt');
const registrationService = require('../services/registrationService');
const trialAccessService = require('../services/trialAccessService');
const { normalizePhoneNumber, INVALID_PHONE_MESSAGE } = require('../utils/phone.util');

const PASSWORD_COST = 12;

function emptyForm() {
  return { firstName: '', lastName: '', phoneNumber: '' };
}

function cleanForm(body) {
  const form = {
    firstName: body.firstName?.trim().slice(0, 100) || '',
    lastName: body.lastName?.trim().slice(0, 100) || '',
    phoneNumber: body.phoneNumber?.trim().slice(0, 30) || '',
  };
  if (!form.firstName || !form.lastName || !form.phoneNumber) {
    throw new registrationService.RegistrationError('INVALID_FORM', 'Tous les champs sont obligatoires.');
  }
  form.phoneNumber = normalizePhoneNumber(form.phoneNumber);
  return form;
}

function validatePassword(password, confirmation) {
  if (!password || !confirmation) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Le mot de passe et sa confirmation sont obligatoires.');
  }
  if (password.length < 8) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Le mot de passe doit contenir au moins 8 caractères.');
  }
  if (password !== confirmation) {
    throw new registrationService.RegistrationError('INVALID_PASSWORD', 'Les mots de passe ne correspondent pas.');
  }
}

function renderUnavailable(res, error) {
  const statusCode = error.statusCode || 400;
  return res.status(statusCode).render('error', {
    title: 'Inscription indisponible',
    message: error.message || 'Cette inscription ne peut pas être effectuée.',
  });
}

function renderForm(res, { session, form, error, accountExists = false }) {
  return res.status(error ? 400 : 200).render('public/registration/new', {
    title: 'Inscription',
    session,
    form,
    error,
    accountExists,
  });
}

function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.user = user;
      return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

async function newForm(req, res) {
  try {
    const session = await registrationService.getSessionForRegistration(req.query.session);
    return renderForm(res, { session, form: emptyForm(), error: null });
  } catch (error) {
    if (error instanceof registrationService.RegistrationError) return renderUnavailable(res, error);
    throw error;
  }
}

async function create(req, res) {
  let session;
  let form = {
    firstName: req.body.firstName?.trim() || '',
    lastName: req.body.lastName?.trim() || '',
    phoneNumber: req.body.phoneNumber?.trim() || '',
  };
  try {
    session = await registrationService.getSessionForRegistration(req.body.sessionId);
    form = cleanForm(req.body);
    validatePassword(req.body.password, req.body.passwordConfirmation);
    const passwordHash = await bcrypt.hash(req.body.password, PASSWORD_COST);
    const result = await registrationService.createRegistration({
      sessionId: session.id,
      ...form,
      passwordHash,
    });
    await establishSession(req, result.user);
    return res.redirect(`/registration/success/${result.enrollment.id}`);
  } catch (error) {
    if (error.message === INVALID_PHONE_MESSAGE) {
      return renderForm(res, { session, form, error: INVALID_PHONE_MESSAGE });
    }
    if (error instanceof registrationService.RegistrationError) {
      if (!session || ['SESSION_REQUIRED', 'SESSION_NOT_FOUND', 'SESSION_UNAVAILABLE', 'REGISTRATION_CLOSED', 'SESSION_FULL'].includes(error.code)) {
        return renderUnavailable(res, error);
      }
      return renderForm(res, {
        session,
        form,
        error: error.message,
        accountExists: ['ACCOUNT_EXISTS', 'DUPLICATE_ENROLLMENT'].includes(error.code),
      });
    }
    throw error;
  }
}

async function success(req, res) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const enrollmentId = Number(req.params.enrollmentId);
  if (!Number.isInteger(enrollmentId) || enrollmentId <= 0) {
    return res.status(404).render('error', {
      title: 'Inscription introuvable',
      message: 'Cette inscription est introuvable.',
    });
  }

  const enrollment = await registrationService.findEnrollmentForViewer(enrollmentId);
  if (!enrollment) {
    return res.status(404).render('error', {
      title: 'Inscription introuvable',
      message: 'Cette inscription est introuvable.',
    });
  }
  if (req.session.user.role !== 'ADMIN' && enrollment.userId !== req.session.user.id) {
    const error = new Error('Accès interdit.');
    error.statusCode = 403;
    throw error;
  }

  const learningOverview = await trialAccessService.getLearningOverview(enrollment.id);
  enrollment.status = learningOverview.trialAccess.enrollmentStatus;
  return res.render('public/registration/success', {
    title: 'Inscription enregistrée',
    enrollment,
    trialAccess: learningOverview.trialAccess,
    classMeetings: learningOverview.classMeetings,
  });
}

module.exports = { newForm, create, success, cleanForm, validatePassword, establishSession };
