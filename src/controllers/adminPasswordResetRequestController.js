const service = require('../services/passwordResetRequestService');
const messages = require('../utils/passwordResetRequestMessages');
const delivery = require('../services/passwordResetDeliveryService');
const { resetEmail } = require('../utils/resetDeliveryConfig');
const maskResetEmail = require('../utils/maskResetEmail');

function locals(res) {
  const language = res.locals.documentLanguage === 'fr' ? 'fr' : 'en';
  return { language, text: messages[language], statuses: service.STATUSES, maskResetEmail,
    formatDate: value => value ? new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(value) : '—' };
}

async function index(req, res) {
  const data = await service.listPasswordResetRequests({ status: req.query.status, page: req.query.page });
  const ui = locals(res);
  res.render('admin/password-reset-requests/index', { ...ui, ...data, title: ui.text.title });
}

async function show(req, res) {
  const request = await service.getPasswordResetRequestById(req.params.id);
  const ui = locals(res);
  const success = ['approved', 'rejected', 'sent'].includes(req.query.success) ? ui.text[req.query.success] : '';
  res.render('admin/password-reset-requests/show', { ...ui, request, hasDeliveryEmail: Boolean(resetEmail(request.user.email)), title: `${ui.text.detail} #${request.id}`, success });
}

async function send(req, res) {
  await delivery.deliverApprovedResetRequest(req.params.id, req.authenticatedUser);
  res.redirect(`/admin/password-reset-requests/${req.params.id}?success=sent&lang=${locals(res).language}`);
}

function review(method, success) {
  return async (req, res) => {
    const request = await service[method](req.params.id, req.authenticatedUser);
    res.redirect(`/admin/password-reset-requests/${request.id}?success=${success}&lang=${locals(res).language}`);
  };
}

function handleError(error, req, res, next) {
  if (error instanceof service.PasswordResetRequestError) error.message = locals(res).text[error.code];
  if (error instanceof delivery.ResetDeliveryError) {
    const ui = locals(res), message = ui.text[error.code] || ui.text.DELIVERY_FAILED;
    // Known delivery failures are safe ADMIN messages; never render a provider exception.
    if (req.accepts(['html', 'json']) === 'json') return res.status(error.statusCode).json({ error: message });
    return res.status(error.statusCode).render('error', { title: ui.text.delivery, message });
  }
  next(error);
}

module.exports = { index, show, send, approve: review('approvePasswordResetRequest', 'approved'), reject: review('rejectPasswordResetRequest', 'rejected'), handleError };
