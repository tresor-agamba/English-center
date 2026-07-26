const prisma = require('../utils/prisma');
const deliveryService = require('../services/whatsappDeliveryService');
const preferences = require('../services/whatsappPreferenceService');
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
module.exports = { deliveries, retry, enable, disable };
