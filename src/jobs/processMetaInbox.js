// Separate CLI only. Importing this module starts no timer, DB or transport.
async function run({ env = process.env, createWorker = options => require('../services/metaInboxWorkerService').createMetaInboxWorker(options),
  observe = (action, data) => require('../services/loggerService').info(action, data) } = {}) {
  if (env.META_INBOX_WORKER_ENABLED !== 'true') return { disabled: true };
  const worker = createWorker({ env, observe });
  let stopping = false, timer, release;
  const wake = () => { stopping = true; if (timer) clearTimeout(timer); if (release) release(); };
  process.once('SIGINT', wake); process.once('SIGTERM', wake);
  try {
    await worker.ready();
    while (!stopping && env.META_INBOX_WORKER_ENABLED === 'true') {
      try { await worker.runOnce(); } catch { /* Fixed diagnostics emitted by service; retry next poll after DB outage. */ }
      if (!stopping) await new Promise(resolve => { release = resolve; timer = setTimeout(resolve, worker.intervalMs); });
    }
  } finally { process.removeListener('SIGINT', wake); process.removeListener('SIGTERM', wake); await worker.close(); }
  return { stopped: true };
}
if (require.main === module) {
  require('dotenv').config();
  run().catch(() => { console.error('META_WORKER_START_FAILED'); process.exitCode = 1; });
}
module.exports = { run };
