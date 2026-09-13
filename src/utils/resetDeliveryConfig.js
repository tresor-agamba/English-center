class ResetDeliveryError extends Error {
  constructor(code, statusCode = 409) {
    super(code); this.name = 'ResetDeliveryError'; this.code = code; this.statusCode = statusCode;
  }
}

// Same simple-address rule as registration, narrowed to one mailbox (no header/list syntax).
function resetEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !/[\x00-\x20\x7f<>,;:"\\()[\]]/.test(email) ? email : null;
}

function appBaseUrl(env = process.env) {
  try {
    const url = new URL(env.APP_BASE_URL);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && url.protocol === 'http:')) throw new Error();
    return url.origin;
  } catch { throw new ResetDeliveryError('EMAIL_NOT_CONFIGURED', 503); }
}

function buildResetLink(base, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ResetDeliveryError('DELIVERY_FAILED', 503);
  return `${base}/reset-password/${token}`;
}

function smtpConfig(env = process.env) {
  const port = Number(env.SMTP_PORT), from = resetEmail(env.EMAIL_FROM);
  if (!env.SMTP_HOST || /[\s/@\\]/.test(env.SMTP_HOST) || !Number.isInteger(port) || port < 1 || port > 65535
      || !['true', 'false'].includes(env.SMTP_SECURE) || !env.SMTP_USER || !env.SMTP_PASSWORD || !from) {
    throw new ResetDeliveryError('EMAIL_NOT_CONFIGURED', 503);
  }
  return { from, options: {
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === 'true', requireTLS: env.SMTP_SECURE !== 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000, dnsTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  } };
}
module.exports = { ResetDeliveryError, resetEmail, appBaseUrl, buildResetLink, smtpConfig };
