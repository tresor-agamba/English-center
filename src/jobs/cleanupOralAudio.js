require('dotenv').config();
const prisma = require('../utils/prisma');
const attempts = require('../services/recordedOralAttemptService');

attempts.cleanupAbandonedDrafts()
  .then(result => console.log(`Nettoyage oral terminé : ${result.removedAttempts} tentative(s), ${result.removedTemporaryFiles} temporaire(s), ${result.failedFiles} fichier(s) en erreur.`))
  .catch(error => {
    console.error('Échec du nettoyage des audios oraux :', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
