const authService = require('../services/authService');
const loginProtection = require('../services/loginProtectionService');
const passwords = require('../services/passwordService');
const { endSession } = require('../middlewares/validateSession');
const passwordResetService = require('../services/passwordResetService');

const { createPasswordResetRequest } = require('../services/passwordResetRequestService');

const LOGIN_ERROR = 'Numéro de téléphone ou mot de passe incorrect.';

function safeSessionId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function showLogin(req, res) {
  const sessionId = safeSessionId(req.query.session);
  res.render('auth/login', { title: 'Connexion', error: null, phoneNumber: '', sessionId });
}

async function login(req, res, next) {
  const phoneNumber = typeof req.body.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
  const password = req.body.password;
  const sessionId = safeSessionId(req.body.sessionId);
  loginProtection.check(req.ip, phoneNumber);

  if (!phoneNumber || typeof password !== 'string' || !password) {
    return res.status(400).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber, sessionId });
  }

  let user;
  try {
    user = await authService.authenticate(phoneNumber, password);
  } catch (error) {
    if (error.message === 'Numéro de téléphone invalide.') {
      return res.status(401).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber, sessionId });
    }
    throw error;
  }

  if (!user) {
    loginProtection.failed(req.ip, phoneNumber, req.requestId);
    return res.status(401).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber, sessionId });
  }
  loginProtection.succeeded(req.ip, phoneNumber);

  return req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    return req.session.save((saveError) => {
      if (saveError) return next(saveError);
      if (user.mustChangePassword) return res.redirect('/change-password');
      if (user.role === 'ADMIN') return res.redirect('/admin/dashboard');
      if (user.role === 'TEACHER') return res.redirect('/teacher');
      return res.redirect(sessionId ? `/enroll?session=${sessionId}` : '/student');
    });
  });
}

function showChangePassword(req, res) {
  if (!req.authenticatedUser) return res.redirect('/login');
  if (!req.authenticatedUser.mustChangePassword) return res.status(403).render('error', { title: 'Accès interdit', message: 'Utilisez votre profil pour modifier votre mot de passe actuel.' });
  return res.render('auth/change-password', { title: 'Modifier le mot de passe', error: null });
}

async function changePassword(req, res, next) {
  if (!req.authenticatedUser) return res.redirect('/login');
  if (!req.authenticatedUser.mustChangePassword) return res.status(403).render('error', { title: 'Accès interdit', message: 'Utilisez votre profil pour modifier votre mot de passe actuel.' });
  const { password, passwordConfirmation } = req.body;
  try {
    passwords.validatePassword(password, passwordConfirmation);
  } catch (error) {
    if (!(error instanceof passwords.PasswordError)) throw error;
    return res.status(400).render('auth/change-password', { title: 'Modifier le mot de passe', error: error.message });
  }
  const passwordHash = await passwords.hashPassword(password);
  await passwords.replacePasswordHash(req.authenticatedUser.id, passwordHash, {
    where: { isActive: true, mustChangePassword: true },
    expectedAuthVersion: req.authenticatedUser.authVersion, mustChangePassword: false,
  });
  return endSession(req, res, next);
}

function showForgotPassword(req, res) { return res.render('auth/forgot-password', { title: 'Mot de passe oublié', sent: false }); }
async function requestPasswordReset(req, res) {
  const identifier = typeof req.body.identifier === 'string' ? req.body.identifier.trim() : '';
  await createPasswordResetRequest(identifier);
  return res.render('auth/forgot-password', { title: 'Mot de passe oublié', sent: true });
}
async function showResetPassword(req, res) {
  const valid = await passwordResetService.findValid(req.params.token);
  if (!valid) return res.status(400).render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: '', error: 'Ce lien est invalide ou expiré.', completed: false });
  return res.render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: req.params.token, error: null, completed: false });
}
async function resetForgottenPassword(req, res) {
  try {
    passwords.validatePassword(req.body.password, req.body.passwordConfirmation);
    await passwordResetService.resetPassword(req.params.token, req.body.password);
    return res.render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: '', error: null, completed: true });
  } catch (error) {
    if (!(error instanceof passwords.PasswordError) && !(error instanceof passwordResetService.PasswordResetError)) throw error;
    // Never redisplay a reset form for an invalid link, even on password validation errors.
    if (error instanceof passwords.PasswordError && !(await passwordResetService.findValid(req.params.token))) {
      error = new passwordResetService.PasswordResetError();
    }
    return res.status(400).render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: error.code === 'INVALID_TOKEN' ? '' : req.params.token, error: error.message, completed: false });
  }
}

function logout(req, res, next) {
  return endSession(req, res, next);
}

module.exports = { showLogin, login, logout, showChangePassword, changePassword, showForgotPassword, requestPasswordReset, showResetPassword, resetForgottenPassword, LOGIN_ERROR };
