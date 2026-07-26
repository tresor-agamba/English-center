const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const preferences = require('./whatsappPreferenceService');
const { normalizePhoneNumber, maskPhoneNumber } = require('../utils/phoneNumber');
const RANK = { ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4 };
function verifySignature(rawBody, header) {
  const secret = getWhatsAppConfig(process.env, { requireValid: true }).appSecret;
  if (!Buffer.isBuffer(rawBody) || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  let actual; try { actual = Buffer.from(header.slice(7), 'hex'); } catch { return false; }
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
async function applyStatus(item) {
  const map = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' }, next = map[item.status];
  if (!next || !item.id) return false;
  const delivery = await prisma.whatsAppDelivery.findUnique({ where: { providerMessageId: item.id } });
  if (!delivery) return false;
  if (next !== 'FAILED' && (delivery.status === 'READ' || (RANK[delivery.status] || 0) >= RANK[next])) return true;
  const timestamp = item.timestamp && /^\d+$/.test(String(item.timestamp)) ? new Date(Number(item.timestamp) * 1000) : new Date();
  const data = next === 'SENT' ? { status: next, sentAt: timestamp } : next === 'DELIVERED' ? { status: next, deliveredAt: timestamp } : next === 'READ' ? { status: next, readAt: timestamp } : { status: next, failedAt: timestamp, failureCode: String(item.errors?.[0]?.code || 'PROVIDER_FAILED').slice(0, 100), failureReason: 'Échec signalé par le fournisseur.' };
  await prisma.whatsAppDelivery.update({ where: { id: delivery.id }, data });
  return true;
}
async function handleInbound(message) {
  const text = message.text?.body?.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
  const stop = ['STOP','ARRET','DESINSCRIRE'].includes(text);
  const phone = normalizePhoneNumber(`+${String(message.from || '').replace(/\D/g, '')}`);
  console.log(`Message WhatsApp entrant reçu : ${message.id || 'sans-id'}, ${maskPhoneNumber(phone)}, type ${message.type || 'inconnu'}`);
  if (!stop || !phone) return;
  const matches = await prisma.whatsAppPreference.findMany({ where: { phoneNumber: phone, hasOptedIn: true }, select: { userId: true }, take: 2 });
  if (matches.length === 1) await preferences.recordWhatsAppOptOut(matches[0].userId);
}
async function processPayload(payload) {
  let statuses = 0;
  for (const entry of payload?.entry || []) for (const change of entry.changes || []) {
    for (const status of change.value?.statuses || []) { await applyStatus(status); statuses += 1; }
    for (const message of change.value?.messages || []) await handleInbound(message);
  }
  return { statuses };
}
module.exports = { verifySignature, applyStatus, processPayload };
