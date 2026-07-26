const prisma = require('../utils/prisma');
const whatsappDeliveryService = require('./whatsappDeliveryService');

class NotificationError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function id(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new NotificationError('Notification invalide.');
  return parsed;
}
function clean(data) {
  const title = data.title?.trim(), message = data.message?.trim();
  if (!title || !message || title.length > 180 || message.length > 2000) throw new NotificationError('Contenu de notification invalide.');
  const actionUrl = data.actionUrl?.trim() || null;
  if (actionUrl && (!actionUrl.startsWith('/') || actionUrl.startsWith('//') || actionUrl.length > 500)) {
    throw new NotificationError('Lien d’action invalide.');
  }
  return { ...data, title, message, actionUrl, relatedEntity: data.relatedEntity?.slice(0, 50) || null };
}
async function createNotification(data, client = prisma) {
  const normalized = clean(data);
  const notification = !normalized.deduplicationKey
    ? await client.notification.create({ data: normalized })
    : await client.notification.upsert({
    where: { deduplicationKey: normalized.deduplicationKey },
    create: normalized, update: {},
  });
  await whatsappDeliveryService.createDeliveryFromNotification(notification.id, client).catch((error) => console.error('Préparation WhatsApp impossible:', error.message));
  return notification;
}
async function createNotificationsForUsers(userIds, data, keyPrefix, client = prisma) {
  const validIds = [...new Set(userIds.map(Number).filter(Number.isInteger))];
  return Promise.all(validIds.map((userId) => createNotification({
    ...data, userId, deduplicationKey: keyPrefix ? `${keyPrefix}:user-${userId}` : undefined,
  }, client)));
}
function getUserNotifications(userId, take = 100) {
  return prisma.notification.findMany({ where: { userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take });
}
function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, readAt: null, deletedAt: null } });
}
function markAsRead(userId, value) {
  return prisma.notification.updateMany({ where: { id: id(value), userId, deletedAt: null }, data: { readAt: new Date() } });
}
function markAllAsRead(userId) {
  return prisma.notification.updateMany({ where: { userId, readAt: null, deletedAt: null }, data: { readAt: new Date() } });
}
function deleteNotification(userId, value) {
  return prisma.notification.updateMany({ where: { id: id(value), userId, deletedAt: null }, data: { deletedAt: new Date() } });
}
module.exports = { NotificationError, createNotification, createNotificationsForUsers, getUserNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
