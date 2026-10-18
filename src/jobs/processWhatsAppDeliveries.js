// Importing the CLI cannot start a worker, load dotenv, or instantiate Prisma.
const poller = require('./whatsappDeliveryPoller');
async function run() { return poller.runOnce(); }
if (require.main === module) {
  require('dotenv').config();
  run().then(results => console.log('Livraisons WhatsApp traitees : ' + results.length + '.'))
    .catch(() => { console.error('WHATSAPP_WORKER_FAILED'); process.exitCode = 1; })
    .finally(async () => {
      const loaded = require.cache[require.resolve('../utils/prisma')];
      if (loaded) await loaded.exports.$disconnect();
    });
}
module.exports = { run };
