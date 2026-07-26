const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const prisma = require('../src/utils/prisma');
const notificationService = require('../src/services/notificationService');
const reminderService = require('../src/services/reminderService');

test('notifications internes et rappels planifiés', async (t) => {
  const suffix = `${Date.now()}${process.pid}`;
  const users = [];
  async function user(index) {
    const row = await prisma.user.create({ data: {
      firstName: 'Notif', lastName: `Test${index}`, phoneNumber: `+1202555${index}${suffix.slice(-4)}`,
      passwordHash: await bcrypt.hash('Notifications@2026', 4), role: 'STUDENT',
    } });
    users.push(row.id); return row;
  }
  try {
    const first = await user(1), second = await user(2);
    await t.test('déduplique une notification et calcule uniquement les non lues', async () => {
      const data = { userId: first.id, type: 'GENERAL_ANNOUNCEMENT', title: 'Information', message: 'Message interne.', deduplicationKey: `test:${suffix}` };
      await notificationService.createNotification(data);
      await notificationService.createNotification(data);
      assert.equal(await prisma.notification.count({ where: { deduplicationKey: data.deduplicationKey } }), 1);
      assert.equal(await notificationService.getUnreadCount(first.id), 1);
      await notificationService.markAllAsRead(first.id);
      assert.equal(await notificationService.getUnreadCount(first.id), 0);
    });
    await t.test('isole lecture et suppression par propriétaire', async () => {
      const row = await notificationService.createNotification({ userId: first.id, type: 'GENERAL_ANNOUNCEMENT', title: 'Privée', message: 'Visible par son propriétaire.' });
      assert.equal((await notificationService.markAsRead(second.id, row.id)).count, 0);
      assert.equal((await notificationService.deleteNotification(second.id, row.id)).count, 0);
      assert.equal((await notificationService.deleteNotification(first.id, row.id)).count, 1);
    });
    await t.test('traite une échéance une seule fois et termine à SENT', async () => {
      const reminder = await reminderService.createReminder({
        userId: first.id, type: 'GENERAL_ANNOUNCEMENT', title: 'Rappel', message: 'Rappel arrivé à échéance.',
        scheduledFor: new Date(Date.now() - 1000), deduplicationKey: `reminder-test:${suffix}`,
      });
      assert.deepEqual(await reminderService.processOne(reminder.id), { sent: true });
      assert.deepEqual(await reminderService.processOne(reminder.id), { skipped: true });
      const stored = await prisma.scheduledReminder.findUnique({ where: { id: reminder.id } });
      assert.equal(stored.status, 'SENT');
      assert.equal(await prisma.notification.count({ where: { deduplicationKey: `reminder:${reminder.deduplicationKey}` } }), 1);
    });
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  }
});
