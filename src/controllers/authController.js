const authService = require('../services/authService');

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
    return res.status(401).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber, sessionId });
  }

  return req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    return req.session.save((saveError) => {
      if (saveError) return next(saveError);
      if (user.role === 'ADMIN') return res.redirect('/admin/dashboard');
      return res.redirect(sessionId ? `/enroll?session=${sessionId}` : '/student');
    });
  });
}

function logout(req, res, next) {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid');
    return res.redirect('/login');
  });
}

module.exports = { showLogin, login, logout, LOGIN_ERROR };
