const service = require('../services/notificationService');
async function index(req, res) {
  res.render('notifications/index', { title: 'Notifications', notifications: await service.getUserNotifications(req.session.user.id) });
}
async function read(req, res) { await service.markAsRead(req.session.user.id, req.params.id); res.redirect(req.body.returnTo?.startsWith('/') ? req.body.returnTo : '/notifications'); }
async function readAll(req, res) { await service.markAllAsRead(req.session.user.id); res.redirect('/notifications'); }
async function remove(req, res) { await service.deleteNotification(req.session.user.id, req.params.id); res.redirect('/notifications'); }
module.exports = { index, read, readAll, remove };
