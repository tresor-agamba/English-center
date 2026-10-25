const prisma = require('../utils/prisma');
const deliveryService = require('../services/whatsappDeliveryService');
const preferences = require('../services/whatsappPreferenceService');
const conversationAdmin = require('../services/whatsappConversationAdminService');
const human = require('../services/whatsappHumanHandoffService');
const crypto = require('crypto');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const STATUSES = ['PENDING','PROCESSING','ACCEPTED','SENT','DELIVERED','READ','FAILED','CANCELLED'];
async function deliveries(req, res) {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const rows = await deliveryService.list(status);
  res.render('admin/whatsapp/deliveries', { title: 'Livraisons WhatsApp', deliveries: rows, status, statuses: STATUSES, maskPhoneNumber: deliveryService.maskPhoneNumber });
}
async function retry(req, res) { await deliveryService.retryFailedDelivery(req.params.id); res.redirect('/admin/whatsapp/deliveries?status=PENDING'); }
async function enable(req, res) {
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, phoneNumber: true } });
  if (!user) { const error = new Error('Utilisateur introuvable.'); error.statusCode = 404; throw error; }
  await preferences.recordWhatsAppOptIn(user.id, req.body.phoneNumber || user.phoneNumber, req.body.source);
  res.redirect(req.get('referer') || '/admin/dashboard');
}
async function disable(req, res) { await preferences.recordWhatsAppOptOut(Number(req.params.id)); res.redirect(req.get('referer') || '/admin/dashboard'); }

async function conversationList(req, res) {
  res.set('Cache-Control', 'no-store');
  const result = await conversationAdmin.list(req.query.filter);
  res.render('admin/whatsapp/conversations', { title: 'Conversations WhatsApp', ...result, filters: conversationAdmin.FILTERS, maskPhoneNumber: deliveryService.maskPhoneNumber });
}
async function conversationDetail(req, res) {
  const conversation = await conversationAdmin.get(req.params.id, req.query.before);
  renderConversation(req, res, conversation);
}
function renderConversation(req, res, conversation, error = '', messageBody = '', submissionId = crypto.randomUUID()) {
  res.set('Cache-Control', 'no-store');
  res.render('admin/whatsapp/conversation', { title: 'Conversation WhatsApp', conversation, queryAction: req.query.action,
    maskPhoneNumber: deliveryService.maskPhoneNumber, currentAdminId: req.authenticatedUser.id,
    whatsappEnabled: human.channelEnabled(), manualError: error, messageBody, submissionId, maxManualLength: human.MAX_MANUAL_LENGTH });
}
async function reply(req, res) {
  const id = conversationAdmin.parseConversationId(req.params.id);
  try {
    await human.queueManualReply(id, req.authenticatedUser.id, req.body.message, req.body.submissionId);
    return res.redirect(303, conversationRedirect(id, 'queued'));
  } catch (error) {
    if (error.code !== 'WHATSAPP_HUMAN_ACTION_REFUSED' || ![400, 409].includes(error.statusCode)) throw error;
    const conversation = await conversationAdmin.get(id);
    res.status(error.statusCode);
    return renderConversation(req, res, conversation, error.message, typeof req.body.message === 'string' ? req.body.message.slice(0, human.MAX_MANUAL_LENGTH) : '',
      typeof req.body.submissionId === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.submissionId) ? req.body.submissionId : crypto.randomUUID());
  }
}
function conversationRedirect(id, result) { return `/admin/whatsapp/conversations/${id}${result ? `?action=${encodeURIComponent(result)}` : ''}`; }
async function takeOver(req, res) {
  const id = conversationAdmin.parseConversationId(req.params.id);
  await human.takeOver(id, req.authenticatedUser.id);
  res.redirect(conversationRedirect(id, 'handoff'));
}
async function pause(req, res) {
  const id = conversationAdmin.parseConversationId(req.params.id);
  const updated = await human.pause(id, req.authenticatedUser.id);
  if (!updated) { const error = new Error('Conversation introuvable.'); error.statusCode = 404; throw error; }
  res.redirect(conversationRedirect(id, 'paused'));
}
async function resume(req, res) {
  const id = conversationAdmin.parseConversationId(req.params.id);
  const updated = await human.resume(id, req.authenticatedUser.id);
  if (!updated) { const error = new Error('Conversation introuvable.'); error.statusCode = 404; throw error; }
  res.redirect(conversationRedirect(id, 'resumed'));
}
module.exports = { deliveries, retry, enable, disable, conversationList, conversationDetail, takeOver, pause, resume, reply };
