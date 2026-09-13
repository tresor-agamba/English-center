const assert = require('node:assert/strict');
const { isolatedEnvironment } = require('../scripts/runWithTestDatabase');
const env = isolatedEnvironment();
assert.equal(env.ACTIVE_TEST_DATABASE_NAME, 'english_center_test');
const { Client } = require('pg');
const client = new Client({ connectionString: env.DATABASE_URL });
(async () => {
  await client.connect();
  const result = await client.query('SELECT current_database() AS database, migration_name, finished_at FROM _prisma_migrations WHERE migration_name = $1 AND rolled_back_at IS NULL', ['20260910200000_link_password_reset_token_to_request']);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].database, 'english_center_test');
  assert.ok(result.rows[0].finished_at);
  console.log(JSON.stringify(result.rows[0]));
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; }).finally(() => client.end());
