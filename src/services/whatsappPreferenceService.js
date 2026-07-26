const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const { normalizePhoneNumber, isValidWhatsAppPhoneNumber } = require('../utils/phoneNumber');
const SOURCES = ['REGISTRATION_FORM','ADMIN_RECORDED','WHATSAPP_INBOUND','EXISTING_CUSTOMER'];
async function canReceiveWhatsApp(userId, client = prisma) {
  if (!getWhatsAppConfig().enabled) return null;
  const user = await client.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, phoneNumber: true, whatsappPreference: true } });
  if (!user?.isActive || !user.whatsappPreference?.isEnabled || !user.whatsappPreference.hasOptedIn) return null;
  const phoneNumber = normalizePhoneNumber(user.whatsappPreference.phoneNumber || user.phoneNumber, getWhatsAppConfig().defaultCountryCode);
  return isValidWhatsAppPhoneNumber(phoneNumber) ? { userId, phoneNumber, preference: user.whatsappPreference } : null;
}
async function recordWhatsAppOptIn(userId, phone, source, client = prisma) {
  if (!SOURCES.includes(source)) { const error = new Error('Source de consentement invalide.'); error.statusCode = 400; throw error; }
  const phoneNumber = normalizePhoneNumber(phone, getWhatsAppConfig().defaultCountryCode);
  if (!isValidWhatsAppPhoneNumber(phoneNumber)) { const error = new Error('Numéro WhatsApp invalide.'); error.statusCode = 400; throw error; }
  return client.whatsAppPreference.upsert({ where: { userId }, create: { userId, phoneNumber, isEnabled: true, hasOptedIn: true, optedInAt: new Date(), source }, update: { phoneNumber, isEnabled: true, hasOptedIn: true, optedInAt: new Date(), optedOutAt: null, source } });
}
async function recordWhatsAppOptOut(userId, client = prisma) {
  const preference = await client.whatsAppPreference.upsert({ where: { userId }, create: { userId, isEnabled: false, hasOptedIn: false, optedOutAt: new Date() }, update: { isEnabled: false, hasOptedIn: false, optedOutAt: new Date() } });
  await client.whatsAppDelivery.updateMany({ where: { userId, status: { in: ['PENDING','PROCESSING','FAILED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date(), failureReason: 'Consentement retiré.' } });
  return preference;
}
module.exports = { SOURCES, canReceiveWhatsApp, recordWhatsAppOptIn, recordWhatsAppOptOut, enableWhatsAppForUser: recordWhatsAppOptIn, disableWhatsAppForUser: recordWhatsAppOptOut };
