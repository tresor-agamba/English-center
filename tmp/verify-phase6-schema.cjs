const env = require('../scripts/runWithTestDatabase').isolatedEnvironment();
require('node:assert/strict').equal(new URL(env.DATABASE_URL).pathname, '/english_center_test');
Object.assign(process.env, env);
const prisma = require('../src/utils/prisma');
(async () => {
  const db = await prisma.$queryRaw`SELECT current_database() AS name`;
  require('node:assert/strict').equal(db[0].name, 'english_center_test');
  const migrations = await prisma.$queryRaw`SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations WHERE migration_name LIKE '202609%' ORDER BY migration_name`;
  console.log(JSON.stringify({ database: db[0].name, migrations }));
})().catch(() => { console.error('TEST_SCHEMA_CHECK_FAILED'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
