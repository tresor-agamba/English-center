require('dotenv').config();
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const backups = require('../src/services/backupService');
const { validateEnvironment } = require('../src/config/environment');
const { commandVersion, assertToolCompatibility } = require('../src/utils/postgresTools');

const TABLES = {
  User: 'user', Course: 'course', Enrollment: 'enrollment', Payment: 'payment', CourseLesson: 'courseLesson', Attendance: 'attendance',
};

function databaseIdentity(value) {
  const url = new URL(value);
  return { host: url.hostname.toLowerCase(), port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1)).toLowerCase() };
}

function sameDatabase(left, right) {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function databaseUrlFor(source, database) {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

function run(binary, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { if (stdout.length < 200_000) stdout += chunk.toString().slice(0, 200_000 - stdout.length); });
    child.stderr.on('data', (chunk) => { if (stderr.length < 20_000) stderr += chunk.toString().slice(0, 20_000 - stderr.length); });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve({ code, stdout, stderr }) : reject(new Error(`Commande PostgreSQL échouée avec le code ${code}: ${stderr.slice(0, 500)}`)));
  });
}

async function counts(client) {
  const values = {};
  for (const [label, model] of Object.entries(TABLES)) values[label] = await client[model].count();
  const migrations = await client.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations"');
  values._prisma_migrations = migrations[0].count;
  return values;
}

async function main() {
  const cfg = validateEnvironment();
  const activeIdentity = databaseIdentity(cfg.databaseUrl);
  const testIdentity = process.env.TEST_DATABASE_URL ? databaseIdentity(process.env.TEST_DATABASE_URL) : null;
  const serverRows = await prisma.$queryRawUnsafe('SHOW server_version');
  const serverVersion = serverRows[0].server_version;
  const dumpVersion = commandVersion(cfg.pgDumpPath);
  const restoreVersion = commandVersion(cfg.pgRestorePath);
  const compatibility = assertToolCompatibility(serverVersion, { pg_dump: dumpVersion.major, pg_restore: restoreVersion.major });
  const sourceCounts = await counts(prisma);

  const backup = await backups.createBackup({ type: 'MANUAL', requestId: `restore-validation-${crypto.randomUUID()}` });
  const verified = await backups.verifyBackup(backup.id, { requirePgRestore: true, requestId: `restore-list-${crypto.randomUUID()}` });
  const download = await backups.getDownload(backup.id);
  const listResult = await run(cfg.pgRestorePath, ['--list', download.absolutePath], process.env);
  if (!/TABLE DATA .* (?:public )?users\b/m.test(listResult.stdout)) throw new Error('La TOC ne contient pas les tables métier attendues');
  if (/TABLE DATA .* (?:public )?http_sessions\b/m.test(listResult.stdout)) throw new Error('http_sessions ne doit pas être incluse dans le dump de récupération');

  const temporaryName = `nva_restore_validation_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  if (!/^nva_restore_validation_\d{13}_[0-9a-f]{8}$/.test(temporaryName)) throw new Error('Nom temporaire invalide');
  const temporaryIdentity = { ...activeIdentity, database: temporaryName.toLowerCase() };
  if (sameDatabase(temporaryIdentity, activeIdentity) || (testIdentity && sameDatabase(temporaryIdentity, testIdentity))) throw new Error('Cible temporaire ambiguë ou active');

  const maintenanceUrl = databaseUrlFor(cfg.databaseUrl, 'postgres');
  const temporaryUrl = databaseUrlFor(cfg.databaseUrl, temporaryName);
  const maintenance = new Client({ connectionString: maintenanceUrl });
  let temporaryCreated = false;
  let restoredPrisma;
  let restoredCounts;
  try {
    await maintenance.connect();
    await maintenance.query(`CREATE DATABASE "${temporaryName}" TEMPLATE template0`);
    temporaryCreated = true;

    const targetUrl = new URL(temporaryUrl);
    const restoreEnv = { ...process.env, PGPASSWORD: decodeURIComponent(targetUrl.password) };
    const restoreArgs = ['-h', targetUrl.hostname, '-p', targetUrl.port || '5432', '-U', decodeURIComponent(targetUrl.username), '-d', temporaryName, '--no-owner', '--no-privileges', '--exit-on-error', download.absolutePath];
    const restoreResult = await run(cfg.pgRestorePath, restoreArgs, restoreEnv);

    restoredPrisma = new PrismaClient({ datasourceUrl: temporaryUrl });
    await restoredPrisma.$connect();
    restoredCounts = await counts(restoredPrisma);
    const tableRows = await restoredPrisma.$queryRawUnsafe("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
    const sessionRows = await restoredPrisma.$queryRawUnsafe("SELECT to_regclass('public.http_sessions')::text AS table_name");
    for (const key of Object.keys(sourceCounts)) if (sourceCounts[key] !== restoredCounts[key]) throw new Error(`COUNT différent pour ${key}`);

    return {
      serverVersion,
      pgDumpVersion: dumpVersion.output,
      pgRestoreVersion: restoreVersion.output,
      compatibility,
      backup: { id: backup.id, sizeBytes: String(backup.sizeBytes), format: 'PGDMP', checksumValidated: verified.verificationStatus === 'VALID', status: backup.status },
      pgRestoreList: { status: 'PASS' },
      temporaryDatabase: { created: true, alias: `${temporaryName.slice(0, 23)}…` },
      restore: { status: 'PASS', exitCode: restoreResult.code, warnings: restoreResult.stderr ? restoreResult.stderr.split(/\r?\n/).filter(Boolean).length : 0 },
      postgresValidation: { status: 'PASS', publicTableCount: tableRows[0].count },
      prismaValidation: { status: 'PASS' },
      counts: Object.fromEntries(Object.keys(sourceCounts).map((key) => [key, { source: sourceCounts[key], restored: restoredCounts[key], match: sourceCounts[key] === restoredCounts[key] }])),
      httpSessions: { included: sessionRows[0].table_name !== null, policy: 'EXCLUDE' },
    };
  } finally {
    if (restoredPrisma) await restoredPrisma.$disconnect().catch(() => {});
    if (temporaryCreated) {
      if (!/^nva_restore_validation_\d{13}_[0-9a-f]{8}$/.test(temporaryName) || sameDatabase(temporaryIdentity, activeIdentity) || (testIdentity && sameDatabase(temporaryIdentity, testIdentity))) throw new Error('Suppression temporaire refusée par le garde-fou');
      await maintenance.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [temporaryName]);
      await maintenance.query(`DROP DATABASE "${temporaryName}"`);
      const exists = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [temporaryName]);
      if (exists.rowCount) throw new Error('La base temporaire existe encore après nettoyage');
    }
    await maintenance.end().catch(() => {});
    await prisma.$disconnect();
  }
}

main().then((result) => console.log(JSON.stringify({ ...result, temporaryDatabase: { ...result.temporaryDatabase, cleaned: true } }, null, 2))).catch((error) => {
  console.error(`[RESTORE_VALIDATION_FAILED] ${error.message}`);
  process.exitCode = 1;
});
