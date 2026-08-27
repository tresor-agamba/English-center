const authService = require('../services/authService');
const loginProtection = require('../services/loginProtectionService');
const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');
const passwordResetService = require('../services/passwordResetService');

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
  const phoneNumber = req.body.phoneNumber?.trim() || '';
  const password = req.body.password;
  const sessionId = safeSessionId(req.body.sessionId);
  loginProtection.check(req.ip, phoneNumber);

  if (!phoneNumber || !password) {
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
  if (!req.session.user) return res.redirect('/login');
  return res.render('auth/change-password', { title: 'Modifier le mot de passe', error: null });
}

async function changePassword(req, res) {
  if (!req.session.user) return res.redirect('/login');
  const { password, passwordConfirmation } = req.body;
  if (!password || password.length < 8 || password !== passwordConfirmation) {
    return res.status(400).render('auth/change-password', { title: 'Modifier le mot de passe', error: password !== passwordConfirmation ? 'Les mots de passe ne correspondent pas.' : 'Utilisez au moins 8 caractères.' });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: req.session.user.id }, data: { passwordHash, mustChangePassword: false } });
  req.session.user.mustChangePassword = false;
  return req.session.save((error) => error ? res.status(500).render('error', { title: 'Erreur', message: 'Impossible d’enregistrer la session.' }) : res.redirect('/student'));
}

function showForgotPassword(req, res) { return res.render('auth/forgot-password', { title: 'Mot de passe oublié', sent: false }); }
async function requestPasswordReset(req, res) {
  await passwordResetService.requestReset(req.body.identifier);
  return res.render('auth/forgot-password', { title: 'Mot de passe oublié', sent: true });
}
async function showResetPassword(req, res) {
  const valid = await passwordResetService.findValid(req.params.token);
  if (!valid) return res.status(400).render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: '', error: 'Ce lien est invalide ou expiré.', completed: false });
  return res.render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: req.params.token, error: null, completed: false });
}
async function resetForgottenPassword(req, res) {
  if (req.body.password !== req.body.passwordConfirmation) return res.status(400).render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: req.params.token, error: 'Les mots de passe ne correspondent pas.', completed: false });
  try {
    await passwordResetService.resetPassword(req.params.token, req.body.password);
    return res.render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: '', error: null, completed: true });
  } catch (error) {
    return res.status(400).render('auth/reset-password', { title: 'Réinitialiser le mot de passe', token: error.code === 'INVALID_TOKEN' ? '' : req.params.token, error: error.message, completed: false });
  }
}

function logout(req, res, next) {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    return res.redirect('/login');
  });
}

module.exports = { showLogin, login, logout, showChangePassword, changePassword, showForgotPassword, requestPasswordReset, showResetPassword, resetForgottenPassword, LOGIN_ERROR };
