const { isolatedEnvironment, runNode } = require('../scripts/runWithTestDatabase');
const env = isolatedEnvironment();
require('node:assert/strict').equal(new URL(env.DATABASE_URL).pathname, '/english_center_test');
env.PRIVATE_STORAGE_ROOT = require('node:path').resolve('tmp/auth-phase6-ui-private');
runNode(['tmp/auth-phase6-ui.cjs'], env);
