const { ResetDeliveryError, smtpConfig } = require('../utils/resetDeliveryConfig');
const loadedForTests = process.env.NODE_ENV === 'test';
const SMTP_DEADLINE_MS = 30000;

function createEmailDeliveryProvider() {
  // Absolute network prohibition in automated tests, including after NODE_ENV changes.
  if (loadedForTests || process.env.NODE_ENV === 'test') throw new ResetDeliveryError('EMAIL_NOT_CONFIGURED', 503);
  const { from, options } = smtpConfig();
  const transporter = require('nodemailer').createTransport(options);
  return {
    async send(message) {
      let timer;
      try {
        const result = await Promise.race([
          transporter.sendMail({ from: { name: 'New Vision Academy', address: from },
            to: { address: message.to }, subject: message.subject, text: message.text, html: message.html }),
          new Promise((_, reject) => { timer = setTimeout(() => { transporter.close(); reject(new Error()); }, SMTP_DEADLINE_MS); }),
        ]);
        if (!result.accepted?.some(address => String(address).toLowerCase() === message.to) || result.rejected?.length) throw new Error();
        return { accepted: true };
      } catch {
        // SMTP errors can contain the entire message, URL and credentials: never propagate them.
        throw new ResetDeliveryError('DELIVERY_FAILED', 503);
      } finally { clearTimeout(timer); transporter.close(); }
    },
  };
}
module.exports = { createEmailDeliveryProvider, SMTP_DEADLINE_MS };
