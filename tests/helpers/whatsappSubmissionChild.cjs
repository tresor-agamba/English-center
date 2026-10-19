// Test protocol subprocess only. Never imports a worker or transport.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { engageSubmission } = require('../../src/services/whatsappSubmissionCoordinator');
let db;
(async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.NVA_META_INBOX_POSTGRES_TESTS, 'dedicated-meta-inbox-reviewed');
  const url = new URL(process.env.NVA_COORDINATOR_TEST_URL);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/nva_whatsapp_test');
  assert.equal(decodeURIComponent(url.username), 'nva_whatsapp_test_admin');
  delete process.env.NVA_COORDINATOR_TEST_URL;
  db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const [i] = await db.$queryRaw`SELECT current_database() AS db,host(inet_server_addr()) AS host,
    inet_server_port() AS port,current_setting('data_directory') AS data,system_identifier::text FROM pg_control_system()`;
  assert.equal(i.db, 'nva_whatsapp_test'); assert.equal(i.host, '127.0.0.1'); assert.equal(i.port, 55432);
  assert.equal(i.data.replaceAll('\\', '/').toLowerCase(), 'd:/nva-whatsapp-test/data'); assert.equal(i.system_identifier, '7696610946073769572');
  let data = ''; for await (const chunk of process.stdin) { data += chunk; assert.ok(data.length < 4096); }
  const input = JSON.parse(data);
  const engaged = await engageSubmission({ database: db, kind: 'conversation', id: input.id, attempts: 1,
    phoneNumber: input.phoneNumber, config: {}, barrier: async tx => {
      const endpoint = await tx.metaWebhookEndpoint.findUnique({ where: { id: input.endpointId } });
      return endpoint?.environment === 'test' && endpoint.disabledAt === null && endpoint.inboxEnabled && endpoint.processingEnabled
        && await tx.metaWebhookEvent.count({ where: { endpointId: input.endpointId, kind: 'INBOUND', state: { notIn: ['PROCESSED', 'IGNORED'] } } }) === 0;
    } });
  if (engaged && input.simulateNetworkCrash === true) {
    console.log(JSON.stringify({ engaged, mockNetworkStarted: true }));
    // A controlled unresolved fake transport. Parent terminates only this test
    // process; engagement is already committed and no SQL transaction is open.
    await new Promise(() => { setInterval(() => {}, 1000); });
  }
  console.log(JSON.stringify({ engaged }));
})().catch(() => { console.log(JSON.stringify({ error: 'COORDINATOR_CHILD_FAILED' })); process.exitCode = 1; })
  .finally(async () => { if (db) await db.$disconnect(); });
