require('dotenv').config();
const prisma = require('../utils/prisma');
const service = require('../services/reminderService');
(async () => {
  try {
    const results = await service.processDue();
    const sent = results.filter(x => x.sent).length, failed = results.filter(x => x.failed).length;
    console.log(`Rappels traités: ${results.length}; envoyés: ${sent}; échecs: ${failed}.`);
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error('Échec du traitement des rappels:', error.message);
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
})();
