function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Une erreur interne est survenue.'
      : error.message || 'Une erreur interne est survenue.';

  return res.status(statusCode).render('error', {
    title: 'Erreur',
    message,
  });
}

module.exports = errorHandler;
