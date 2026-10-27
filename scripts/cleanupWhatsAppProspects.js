// No scheduler; simulation unless the operator explicitly passes --apply.
async function run() {
  require('dotenv').config({ quiet: true });
  const db = require('../src/utils/prisma');
  try {
    const result = await require('../src/services/whatsappProspectRetentionService').purgeInactiveProspects(db, { dryRun: !process.argv.includes('--apply') });
    console.log(JSON.stringify(result));
  } finally { await db.$disconnect(); }
}
if (require.main === module) run().catch(() => { console.error('WHATSAPP_RETENTION_FAILED'); process.exitCode = 1; });
module.exports = { run };
