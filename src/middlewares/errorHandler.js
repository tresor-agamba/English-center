function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || 500;
  const message =
    statusCode >= 500
      ? 'Une erreur interne est survenue. Veuillez réessayer plus tard.'
      : error.message || 'Une erreur est survenue.';

  return res.status(statusCode).render('error', {
    title: 'Erreur',
    message,
  });
}

module.exports = errorHandler;
