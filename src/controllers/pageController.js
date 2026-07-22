function showHome(req, res) {
  res.render('home', { title: 'Accueil' });
}

module.exports = { showHome };
