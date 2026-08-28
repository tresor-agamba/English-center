const paymentService = require('../services/paymentService');
const manualPaymentService = require('../services/manualPaymentService');
const receiptPdf = require('../services/paymentReceiptPdfService');

function renderPaymentError(res, error) {
  return res.status(error.statusCode || 400).render('student/payment/error', {
    title: 'Paiement indisponible',
    message: error.message || 'Cette opération de paiement est indisponible.',
    paymentErrorContext: 'student',
  });
}

async function create(req, res) {
  try {
    if (req.body.flow === 'manual') {
      const methods = await manualPaymentService.listMethods({ enabledOnly: true, currency: req.body.currency });
      if (!methods.length) throw new manualPaymentService.ManualPaymentError('NO_PAYMENT_METHOD', 'Aucun moyen de paiement n’est actuellement disponible dans cette devise.');
    }
    const result = await paymentService.createPaymentAttempt({
      userId: req.session.user.id,
      enrollmentId: req.body.enrollmentId,
      amount: req.body.amount,
      currency: req.body.currency,
      flow: req.body.flow,
    });
    if (result.redirectToEnrollment) {
      return res.redirect(`/student/courses/${result.enrollmentId}`);
    }
    return res.redirect(`/payments/${result.paymentReference}`);
  } catch (error) {
    if (error instanceof paymentService.PaymentError || error instanceof manualPaymentService.ManualPaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

async function show(req, res) {
  try {
    const payment = await paymentService.getPaymentForStudent(req.params.reference, req.session.user.id);
    const manualMethods = payment.provider === 'manual'
      ? await manualPaymentService.listMethods({ enabledOnly: true, currency: payment.currency })
      : [];
    return res.render('student/payment/show', {
      title: `Paiement ${payment.reference}`,
      payment,
      manualMethods,
      simulationEnabled: process.env.NODE_ENV !== 'production',
    });
  } catch (error) {
    if (error instanceof paymentService.PaymentError) return renderPaymentError(res, error);
    throw error;
  }
}

async function declare(req, res) {
  try {
    await manualPaymentService.declarePayment(req.params.reference, req.session.user.id, req.body, req.file);
    return res.redirect(`/payments/${req.params.reference}?declared=1`);
  } catch (error) {
    if (error instanceof manualPaymentService.ManualPaymentError) return renderPaymentError(res, error);
    throw error;
  }
}
async function proof(req, res) {
  try {
    const item = await manualPaymentService.proof(req.params.reference, { id: req.session.user.id, role: 'STUDENT' });
    return res.type(item.mimeType).setHeader('Cache-Control', 'private, no-store').sendFile(item.absolutePath);
  } catch (error) {
    if (error instanceof manualPaymentService.ManualPaymentError) return renderPaymentError(res, error);
    throw error;
  }
}
async function receipt(req, res) {
  try {
    const payment = await manualPaymentService.receipt(req.params.reference, { id: req.session.user.id, role: 'STUDENT' });
    const buffer = await receiptPdf.generateManual(payment);
    return res.type('application/pdf').setHeader('Content-Disposition', `attachment; filename="${payment.metadata.receiptNumber}.pdf"`).send(buffer);
  } catch (error) {
    if (error instanceof manualPaymentService.ManualPaymentError) return renderPaymentError(res, error);
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

module.exports = { create, show, declare, proof, receipt, simulateSuccess, simulateFailure };
