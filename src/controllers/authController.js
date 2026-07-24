const authService = require('../services/authService');

const LOGIN_ERROR = 'Numéro de téléphone ou mot de passe incorrect.';

function showLogin(req, res) {
  res.render('auth/login', { title: 'Connexion', error: null, phoneNumber: '' });
}

async function login(req, res, next) {
  const phoneNumber = req.body.phoneNumber?.trim() || '';
  const password = req.body.password;

  if (!phoneNumber || !password) {
    return res.status(400).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber });
  }

  let user;
  try {
    user = await authService.authenticate(phoneNumber, password);
  } catch (error) {
    if (error.message === 'Numéro de téléphone invalide.') {
      return res.status(401).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber });
    }
    throw error;
  }

  if (!user) {
    return res.status(401).render('auth/login', { title: 'Connexion', error: LOGIN_ERROR, phoneNumber });
  }

  return req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = user;
    return req.session.save((saveError) => {
      if (saveError) return next(saveError);
      return res.redirect(user.role === 'ADMIN' ? '/admin/dashboard' : '/');
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
