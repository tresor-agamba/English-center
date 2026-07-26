require('dotenv').config();
const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const service = require('../services/whatsappDeliveryService');
(async () => {
  try {
    const config = getWhatsAppConfig();
    if (!config.enabled) { console.log('Canal WhatsApp désactivé. Aucune livraison traitée.'); return; }
    getWhatsAppConfig(process.env, { requireValid: true });
    const results = await service.processPending();
    console.log(`Livraisons analysées: ${results.length}; acceptées: ${results.filter(x => x.accepted).length}; échecs: ${results.filter(x => x.failed).length}; ignorées: ${results.filter(x => x.skipped || x.cancelled).length}.`);
  } catch (error) { console.error('Worker WhatsApp:', error.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
})();
