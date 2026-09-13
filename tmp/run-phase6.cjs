const { isolatedEnvironment, runNode } = require('../scripts/runWithTestDatabase');
const env = isolatedEnvironment();
require('node:assert/strict').equal(new URL(env.DATABASE_URL).pathname, '/english_center_test');
env.PRIVATE_STORAGE_ROOT = require('node:path').resolve(process.argv.length > 2 ? 'tmp/auth-phase6-private' : 'tmp/auth-phase6-full-private');
const args = process.argv.slice(2);
runNode(['--test', '--test-concurrency=1', '--test-reporter=tap', ...args], env);

