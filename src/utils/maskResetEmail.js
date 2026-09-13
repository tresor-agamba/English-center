const { resetEmail } = require('./resetDeliveryConfig');
module.exports = function maskResetEmail(value) {
  const email = resetEmail(value);
  if (!email) return '—';
  const [local, domain] = email.split('@');
  return `${local.slice(0, Math.min(2, Math.max(1, local.length - 1)))}***@${domain}`;
};
