require('dotenv').config();
const { spawnSync } = require('node:child_process');
const { assertSafeTestDatabase } = require('../src/utils/testDatabaseGuard');
const { runPrismaGenerate } = require('./generatePrismaClient');

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function prismaArgs(...args) {
  return [require.resolve('prisma/build/index.js'), ...args];
}

function playwrightArgs(...args) {
  return [require.resolve('@playwright/test/cli'), ...args];
}

function isolatedEnvironment() {
  const { test } = assertSafeTestDatabase(process.env);
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    ACTIVE_TEST_DATABASE_NAME: test.databaseName,
  };
}

function prepare(env) {
  runPrismaGenerate(env);
  runNode(prismaArgs('migrate', 'deploy'), env);
}

function reset(env) {
  runPrismaGenerate(env);
  runNode(prismaArgs('migrate', 'reset', '--force', '--skip-seed', '--skip-generate'), env);
}

function main(mode = process.argv[2]) {
  const env = isolatedEnvironment();
  if (mode === 'prepare') return prepare(env);
  if (mode === 'reset') return reset(env);
  if (mode === 'test') {
    reset(env);
    return runNode(['--test', '--test-concurrency=1'], env);
  }
  if (mode === 'responsive') {
    reset(env);
    return runNode(playwrightArgs('test'), env);
  }
  throw new Error('Mode attendu : prepare, reset, test ou responsive.');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[TEST_DATABASE_REFUSED] ${error.code || error.name}: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runNode, isolatedEnvironment, prepare, reset, main };
