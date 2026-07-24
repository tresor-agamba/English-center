const PROVIDER_NAME = 'development';
const PAYMENT_LIFETIME_MINUTES = 30;

function initializePayment() {
  return {
    provider: PROVIDER_NAME,
    expiresAt: new Date(Date.now() + PAYMENT_LIFETIME_MINUTES * 60 * 1000),
  };
}

function verifyPayment(payment) {
  return { verified: payment.status === 'SUCCESS', providerReference: payment.providerReference };
}

function handleWebhook() {
  throw new Error('Les webhooks ne sont pas disponibles avec le fournisseur de développement.');
}

module.exports = { PROVIDER_NAME, PAYMENT_LIFETIME_MINUTES, initializePayment, verifyPayment, handleWebhook };
