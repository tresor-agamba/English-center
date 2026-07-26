const prisma = require('../utils/prisma');
const audience = require('../services/notificationAudienceService');
const notifications = require('../services/notificationService');
async function index(req, res) {
  res.render('admin/notifications/announcements/index', { title: 'Annonces', announcements: await prisma.announcement.findMany({ include: { createdBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' } }) });
}
async function newForm(req, res) {
  const [courses, sessions] = await Promise.all([prisma.course.findMany({ select: { id: true, title: true }, orderBy: { title: 'asc' } }), prisma.trainingSession.findMany({ select: { id: true, name: true }, orderBy: { startDate: 'desc' } })]);
  res.render('admin/notifications/announcements/new', { title: 'Nouvelle annonce', courses, sessions, error: null });
}
async function create(req, res) {
  const title = req.body.title?.trim(), message = req.body.message?.trim(), type = req.body.audienceType;
  if (!title || !message || title.length > 180 || message.length > 2000 || !['ALL','STUDENTS','TEACHERS','COURSE','SESSION'].includes(type)) {
    const error = new Error('Annonce invalide.'); error.statusCode = 400; throw error;
  }
  const ids = await audience.resolve(type, req.body.audienceRef);
  const announcement = await prisma.announcement.create({ data: { title, message, actionUrl: req.body.actionUrl?.startsWith('/') ? req.body.actionUrl : null, audienceType: type, audienceRef: req.body.audienceRef || null, recipientCount: ids.length, createdById: req.session.user.id } });
  await notifications.createNotificationsForUsers(ids, { type: 'GENERAL_ANNOUNCEMENT', title, message, actionUrl: announcement.actionUrl, relatedEntity: 'ANNOUNCEMENT', relatedId: announcement.id }, `ANNOUNCEMENT:${announcement.id}`);
  res.redirect('/admin/notifications/announcements');
}
module.exports = { index, newForm, create };
