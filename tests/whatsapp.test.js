const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const prisma = require('../src/utils/prisma');
const { getWhatsAppConfig } = require('../src/config/whatsappConfig');
const phone = require('../src/utils/phoneNumber');
const preferences = require('../src/services/whatsappPreferenceService');
const deliveries = require('../src/services/whatsappDeliveryService');
const notifications = require('../src/services/notificationService');
const webhook = require('../src/services/whatsappWebhookService');

test('canal transactionnel WhatsApp', async (t) => {
  const oldEnv = { ...process.env }, key = `${Date.now()}${process.pid}`;
  let userId;
  try {
    process.env.WHATSAPP_ENABLED = 'true'; process.env.WHATSAPP_FAKE_MODE = 'true';
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-test'; process.env.WHATSAPP_APP_SECRET = 'secret-test';
    await t.test('valide la configuration et refuse les secrets manquants', () => {
      assert.equal(getWhatsAppConfig(process.env, { requireValid: true }).fakeMode, true);
      assert.throws(() => getWhatsAppConfig({ WHATSAPP_ENABLED: 'true' }, { requireValid: true }), /incomplète/);
      assert.equal(getWhatsAppConfig({ WHATSAPP_ENABLED: 'false' }, { requireValid: true }).enabled, false);
    });
    await t.test('normalise et masque les numéros sans transformation ambiguë', () => {
      assert.equal(phone.normalizePhoneNumber('0821234567'), '+243821234567');
      assert.equal(phone.normalizePhoneNumber('+33 6 12 34 56 78'), '+33612345678');
      assert.equal(phone.normalizePhoneNumber('821234567'), null);
      assert.equal(phone.isValidWhatsAppPhoneNumber('+243821234567'), true);
      assert.match(phone.maskPhoneNumber('+243821234567'), /^\+243\*+567$/);
    });
    const user = await prisma.user.create({ data: { firstName: 'WhatsApp', lastName: 'Test', phoneNumber: `+24389${key.slice(-7)}`, passwordHash: 'test', role: 'STUDENT' } }); userId = user.id;
    await t.test('exige le consentement puis annule au retrait', async () => {
      assert.equal(await preferences.canReceiveWhatsApp(user.id), null);
      await preferences.recordWhatsAppOptIn(user.id, '0821234567', 'REGISTRATION_FORM');
      assert.equal((await preferences.canReceiveWhatsApp(user.id)).phoneNumber, '+243821234567');
    });
    let delivery;
    await t.test('crée une livraison dédupliquée et l’accepte sans réseau en faux mode', async () => {
      const data = { userId: user.id, type: 'PAYMENT_REQUIRED', title: 'Paiement requis', message: 'Consultez votre espace.', deduplicationKey: `wa-test:${key}` };
      const first = await notifications.createNotification(data); await notifications.createNotification(data);
      assert.equal(await prisma.whatsAppDelivery.count({ where: { notificationId: first.id } }), 1);
      delivery = await prisma.whatsAppDelivery.findFirst({ where: { notificationId: first.id } });
      assert.ok((await deliveries.sendDelivery(delivery.id)).accepted);
      delivery = await prisma.whatsAppDelivery.findUnique({ where: { id: delivery.id } });
      assert.equal(delivery.status, 'ACCEPTED'); assert.match(delivery.providerMessageId, /^fake-/);
    });
    await t.test('vérifie la signature et applique les statuts de façon monotone', async () => {
      const raw = Buffer.from('{"object":"whatsapp_business_account"}');
      const signature = `sha256=${crypto.createHmac('sha256', 'secret-test').update(raw).digest('hex')}`;
      assert.equal(webhook.verifySignature(raw, signature), true);
      assert.equal(webhook.verifySignature(raw, 'sha256=00'), false);
      await webhook.applyStatus({ id: delivery.providerMessageId, status: 'delivered', timestamp: String(Math.floor(Date.now()/1000)) });
      await webhook.applyStatus({ id: delivery.providerMessageId, status: 'sent' });
      assert.equal((await prisma.whatsAppDelivery.findUnique({ where: { id: delivery.id } })).status, 'DELIVERED');
      await webhook.applyStatus({ id: delivery.providerMessageId, status: 'read' });
      assert.equal((await prisma.whatsAppDelivery.findUnique({ where: { id: delivery.id } })).status, 'READ');
    });
    await t.test('retire le consentement sans supprimer la notification interne', async () => {
      await preferences.recordWhatsAppOptOut(user.id);
      assert.equal(await preferences.canReceiveWhatsApp(user.id), null);
      assert.ok(await prisma.notification.count({ where: { userId: user.id } }) > 0);
    });
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
