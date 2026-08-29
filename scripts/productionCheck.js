require('dotenv').config();
const fs = require('fs/promises');
const { spawnSync } = require('child_process');
const prisma = require('../src/utils/prisma');
const { validateEnvironment } = require('../src/config/environment');
const backups = require('../src/services/backupService');
const sessionStore = require('../src/config/sessionStore');
const expressSession = require('express-session');
const { commandVersion, assertToolCompatibility } = require('../src/utils/postgresTools');
const path = require('path');

function runPrisma(...args) {
  const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], {
    cwd: path.resolve(__dirname, '..'), env: process.env, windowsHide: true, encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error((result.stderr || result.stdout).trim().slice(0, 500));
  }
  return result.stdout;
}
async function main() {
  const results = [];
  const check = async (name, fn, { required = true, detail } = {}) => {
    try { await fn(); results.push({ name, status: 'OK', detail: detail ? String(detail()).slice(0, 120) : '' }); } catch (error) { results.push({ name, status: required ? 'FAIL' : 'WARN', detail: error.message }); }
  };
  await check('Variables de production', () => validateEnvironment(process.env, { production: true }));
  await check('Schéma Prisma', () => runPrisma('validate'));
  await check('Client Prisma généré', async () => {
    await prisma.$queryRawUnsafe('SELECT 1');
    const linuxEngine = path.resolve(__dirname, '..', 'node_modules', '.prisma', 'client', 'libquery_engine-debian-openssl-3.0.x.so.node');
    await fs.access(linuxEngine);
  });
  let serverVersion;
  let pgDumpVersion;
  let pgRestoreVersion;
  await check('Connexion PostgreSQL', async () => {
    const rows = await prisma.$queryRawUnsafe('SHOW server_version');
    serverVersion = rows[0].server_version;
  });
  await check('PostgreSQL server version', () => { if (!serverVersion) throw new Error('Version serveur indisponible'); }, { detail: () => serverVersion });
  await check('Migrations Prisma', () => {
    const migrationEnv = { ...process.env };
    if (process.platform === 'win32' && migrationEnv.DATABASE_URL && !migrationEnv.DATABASE_URL.includes('sslmode=')) migrationEnv.DATABASE_URL += `${migrationEnv.DATABASE_URL.includes('?') ? '&' : '?'}sslmode=disable`;
    const command = process.platform === 'win32' ? process.execPath : 'npx';
    const args = process.platform === 'win32'
      ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'), 'prisma', 'migrate', 'status']
      : ['prisma', 'migrate', 'status'];
    const result = spawnSync(command, args, { cwd: path.resolve(__dirname, '..'), env: migrationEnv, windowsHide: true, encoding: 'utf8' });
    if (result.error || result.status !== 0 || !/up to date/i.test(result.stdout)) throw result.error || new Error((result.stderr || result.stdout).slice(0, 500));
  });
  await check('Stockage privé', async () => { const root = await backups.ensureStorage(); await fs.access(root); });
  await check('Espace disque', () => backups.checkDiskSpace());
  await check('pg_dump version', () => { pgDumpVersion = commandVersion(process.env.PG_DUMP_PATH || 'pg_dump'); }, { detail: () => pgDumpVersion.output });
  await check('pg_restore version', () => { pgRestoreVersion = commandVersion(process.env.PG_RESTORE_PATH || 'pg_restore'); }, { detail: () => pgRestoreVersion.output });
  await check('Compatibilité PostgreSQL CLI', () => assertToolCompatibility(serverVersion, {
    pg_dump: pgDumpVersion?.major,
    pg_restore: pgRestoreVersion?.major,
  }));
  await check('Routes', () => require('../src/app'));
  await check('Vues EJS', () => require('./validateEjs'));
  await check('Configuration session', async () => {
    const cfg = validateEnvironment(process.env, { production: true });
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) throw new Error('Secret de session faible');
    const app = require('../src/app');
    if (!app.locals.sessionStore || app.locals.sessionStore instanceof expressSession.MemoryStore || app.locals.sessionStore !== sessionStore.getSessionStore()) {
      throw new Error('MemoryStore interdit en production');
    }
    await sessionStore.verifySessionStore();
  });
  await check('Détection de secrets', async () => {
    const roots = ['src', 'views', 'public']; const forbidden = /(?:SESSION_SECRET|ACCESS_TOKEN|APP_SECRET)\s*=\s*['"][^'"]+['"]/;
    async function scan(root) { for (const entry of await fs.readdir(root, { withFileTypes: true })) { const target = require('path').join(root, entry.name); if (entry.isDirectory()) await scan(target); else if (/\.(?:js|ejs|cjs)$/.test(entry.name) && forbidden.test(await fs.readFile(target, 'utf8'))) throw new Error(`Secret potentiel dans ${target}`); } }
    for (const root of roots) await scan(root);
  });
  await check('Statut sauvegardes', async () => { const failed = await prisma.databaseBackup.count({ where: { status: 'FAILED', createdAt: { gt: new Date(Date.now() - 86400000) } } }); if (failed) throw new Error(`${failed} sauvegarde(s) échouée(s) récemment`); }, { required: false });
  console.table(results);
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1;
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await sessionStore.closeSessionStore();
  await prisma.$disconnect();
});
