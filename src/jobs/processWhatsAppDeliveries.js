require('dotenv').config();
const prisma = require('../utils/prisma');
const { getWhatsAppConfig } = require('../config/whatsappConfig');
const service = require('../services/whatsappDeliveryService');
const conversationService = require('../services/whatsappConversationDeliveryService');
const prospectFollowUps = require('../services/whatsappProspectFollowUpService');
(async () => {
  try {
    const config = getWhatsAppConfig();
    if (!config.enabled) { console.log('Canal WhatsApp désactivé. Aucune livraison traitée.'); return; }
    getWhatsAppConfig(process.env, { requireValid: true });
    const results = await service.processPending();
    const conversationResults = await conversationService.processPending();
    const followUpResults = await prospectFollowUps.processPending();
    console.log(`Relances prospects traitées: ${followUpResults.length}; acceptées: ${followUpResults.filter(x => x.accepted).length}; échecs: ${followUpResults.filter(x => x.failed).length}.`);
    console.log(`Réponses de conversation traitées: ${conversationResults.length}; acceptées: ${conversationResults.filter(x => x.accepted).length}; échecs: ${conversationResults.filter(x => x.failed).length}.`);
    console.log(`Livraisons analysées: ${results.length}; acceptées: ${results.filter(x => x.accepted).length}; échecs: ${results.filter(x => x.failed).length}; ignorées: ${results.filter(x => x.skipped || x.cancelled).length}.`);
  } catch (error) { console.error('Worker WhatsApp:', error.message); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
})();
