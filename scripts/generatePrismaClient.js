const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const generatedClientDir = path.join(projectRoot, 'node_modules', '.prisma', 'client');
const lockPath = path.join(projectRoot, 'node_modules', '.prisma', 'generate.lock');
const engineNames = [
  'query_engine-windows.dll.node',
  'libquery_engine-debian-openssl-3.0.x.so.node',
];

function acquireLock() {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const descriptor = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(descriptor, String(process.pid));
    return descriptor;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const owner = Number.parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
      let active = Number.isInteger(owner);
      if (active) {
        try { process.kill(owner, 0); } catch (processError) { active = processError.code !== 'ESRCH'; }
      }
      if (!active) {
        fs.rmSync(lockPath, { force: true });
        return acquireLock();
      }
      throw new Error(`Une génération Prisma est déjà en cours (PID ${owner}).`);
    }
    throw error;
  }
}

function prepareWindowsEngineReplacement() {
  if (process.platform !== 'win32' || !fs.existsSync(generatedClientDir)) return [];

  const backups = [];
  for (const engineName of engineNames) {
    const source = path.join(generatedClientDir, engineName);
    if (!fs.existsSync(source)) continue;
    const backup = `${source}.generate-backup-${process.pid}-${Date.now()}`;
    fs.renameSync(source, backup);
    backups.push({ source, backup });
  }
  return backups;
}

function runPrismaGenerate(env = process.env) {
  const lock = acquireLock();
  let backups = [];
  try {
    backups = prepareWindowsEngineReplacement();
    const result = spawnSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'generate'],
      { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      for (const { source, backup } of backups) {
        if (!fs.existsSync(source) && fs.existsSync(backup)) fs.renameSync(backup, source);
      }
      throw new Error(`prisma generate a échoué avec le code ${result.status ?? 1}.`);
    }
    return result.status;
  } finally {
    for (const { backup } of backups) fs.rmSync(backup, { force: true, maxRetries: 5, retryDelay: 100 });
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

if (require.main === module) {
  try {
    runPrismaGenerate();
  } catch (error) {
    console.error(`[PRISMA_GENERATE_FAILED] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { runPrismaGenerate, prepareWindowsEngineReplacement };
