require('dotenv').config();
const prisma = require('../src/utils/prisma');
const backups = require('../src/services/backupService');
async function main() {
  const [command, id] = process.argv.slice(2);
  if (command === 'create') console.log(JSON.stringify(await backups.createBackup({ type: process.env.BACKUP_TYPE === 'SCHEDULED' ? 'SCHEDULED' : 'MANUAL' }), (_, value) => typeof value === 'bigint' ? value.toString() : value));
  else if (command === 'list') console.table((await backups.list()).map((item) => ({ id: item.id, status: item.status, type: item.type, size: item.sizeBytes?.toString(), createdAt: item.createdAt })));
  else if (command === 'verify') { if (!id) throw new Error('Identifiant obligatoire.'); console.log((await backups.verifyBackup(id, { requirePgRestore: true })).verificationStatus); }
  else if (command === 'cleanup') console.log(await backups.cleanup());
  else if (command === 'restore') { if (!id) throw new Error('Identifiant obligatoire.'); await backups.restoreBackup(id, { confirmation: process.env.BACKUP_RESTORE_CONFIRMATION_INPUT }); console.log('Restauration terminée.'); }
  else throw new Error('Commande attendue : create, list, verify, cleanup ou restore.');
}
main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(`Échec : ${error.message}`); await prisma.$disconnect(); process.exitCode = 1; });
