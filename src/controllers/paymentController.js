const paymentService = require('../services/paymentService');

function renderPaymentError(res, error) {
  return res.status(error.statusCode || 400).render('student/payment/error', {
    title: 'Paiement indisponible',
    message: error.message || 'Cette opération de paiement est indisponible.',
  });
}

async function create(req, res) {
  try {
    const result = await paymentService.createPaymentAttempt({
      userId: req.session.user.id,
      enrollmentId: req.body.enrollmentId,
    });
    if (result.redirectToEnrollment) {
      return res.redirect(`/student/courses/${result.enrollmentId}`);
    }
    return res.redirect(`/payments/${result.paymentReference}`);
  } catch (error) {
    if (error instanceof paymentService.PaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

async function show(req, res) {
  try {
    const payment = await paymentService.getPaymentForStudent(req.params.reference, req.session.user.id);
    return res.render('student/payment/show', {
      title: `Paiement ${payment.reference}`,
      payment,
      simulationEnabled: process.env.NODE_ENV !== 'production',
    });
  } catch (error) {
    if (error instanceof paymentService.PaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

async function simulateSuccess(req, res) {
  try {
    const result = await paymentService.simulateSuccess(req.params.reference, req.session.user.id);
    return res.redirect(`/student/courses/${result.enrollmentId}`);
  } catch (error) {
    if (error instanceof paymentService.PaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

async function simulateFailure(req, res) {
  try {
    const result = await paymentService.simulateFailure(req.params.reference, req.session.user.id);
    return res.redirect(`/student/courses/${result.enrollmentId}`);
  } catch (error) {
    if (error instanceof paymentService.PaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

module.exports = { create, show, simulateSuccess, simulateFailure };
