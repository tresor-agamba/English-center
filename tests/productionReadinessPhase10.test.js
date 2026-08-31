require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const http = require('http');
const prisma = require('../src/utils/prisma');
const backups = require('../src/services/backupService');
const health = require('../src/services/systemHealthService');
const { validateEnvironment } = require('../src/config/environment');
const loginProtection = require('../src/services/loginProtectionService');
const logger = require('../src/services/loggerService');
const requestContext = require('../src/middlewares/requestContext');
const errorHandler = require('../src/middlewares/errorHandler');
const requireAdmin = require('../src/middlewares/requireAdmin');
const app = require('../src/app');

const key = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let admin;
const dump = async (target) => fs.writeFile(target, Buffer.from('PGDMP phase-10 isolated test dump'));
function request(pathname) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: pathname, headers: { Accept: 'application/json' } }, (res) => {
        const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
    });
  });
}
test('Phase 10 — préparation production, sauvegardes et sécurité', async (t) => {
  admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Production', phoneNumber: `+243897${key}`, passwordHash: 'x', role: 'ADMIN' } });
  await prisma.backupAuditLog.deleteMany();
  await prisma.databaseBackup.deleteMany();
  await prisma.systemOperationLock.deleteMany();
  await prisma.backupPolicy.deleteMany();

  await t.test('crée une sauvegarde custom simulée avec statut, taille et checksum', async () => {
    const item = await backups.createBackup({ actorId: admin.id, dumpRunner: dump, requestId: 'phase10-create' });
    assert.equal(item.status, 'COMPLETED'); assert.ok(item.sizeBytes > 0n);
    assert.match(item.storageKey, /^[0-9a-f-]{36}\.dump$/); assert.match(item.checksumSha256, /^[0-9a-f]{64}$/);
  });
  await t.test('vérifie taille, en-tête et checksum puis rejette un dump altéré', async () => {
    const item = (await backups.list()).find((row) => row.status === 'COMPLETED');
    assert.equal((await backups.verifyBackup(item.id, { runPgRestoreList: false })).verificationStatus, 'VALID');
    const downloadable = await backups.getDownload(item.id, { actorId: admin.id, requestId: 'download' });
    assert.ok(downloadable.absolutePath.includes('backups')); assert.ok(!downloadable.downloadName.includes(downloadable.absolutePath));
    await fs.appendFile(downloadable.absolutePath, 'ALTERED');
    await assert.rejects(() => backups.verifyBackup(item.id, { runPgRestoreList: false }), /échoué/);
    await fs.writeFile(downloadable.absolutePath, Buffer.from('PGDMP phase-10 isolated test dump'));
  });
  await t.test('protège IDOR et refuse les rôles enseignant/étudiant', async () => {
    await assert.rejects(() => backups.getDownload('00000000-0000-0000-0000-000000000000'), /introuvable/);
    for (const role of ['TEACHER', 'STUDENT']) {
      let error; requireAdmin({ session: { user: { role } } }, {}, (value) => { error = value; });
      assert.equal(error.statusCode, 403);
    }
  });
  await t.test('empêche deux sauvegardes simultanées et nettoie les fichiers partiels', async () => {
    let release; const waiting = new Promise((resolve) => { release = resolve; });
    const first = backups.createBackup({ actorId: admin.id, dumpRunner: async (target) => { await waiting; await dump(target); } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await assert.rejects(() => backups.createBackup({ actorId: admin.id, dumpRunner: dump }), /déjà en cours/);
    release(); await first;
    const root = await backups.ensureStorage(); await fs.writeFile(`${root}/orphan.partial`, 'incomplete');
    await backups.cleanup({ actorId: admin.id });
    await assert.rejects(() => fs.access(`${root}/orphan.partial`));
  });
  await t.test('applique la politique de rétention sans URL publique', async () => {
    const policy = await backups.updatePolicy({ retentionDays: 30, maxBackups: 1, autoCleanup: true, dailyBackup: false, dailyBackupTime: '02:00' });
    assert.equal(policy.maxBackups, 1);
    await backups.createBackup({ actorId: admin.id, dumpRunner: dump });
    const cleaned = await backups.cleanup({ actorId: admin.id });
    assert.ok(cleaned.removed >= 1);
    assert.equal(await fs.access(backups.backupRoot()).then(() => true), true);
  });
  await t.test('expose une santé publique minimale et une santé admin détaillée', async () => {
    const response = await request('/health');
    assert.equal(response.status, 200); assert.deepEqual(JSON.parse(response.body), { status: 'ok' });
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    const detailed = await health.detailedHealth();
    assert.equal(detailed.application, 'ok'); assert.equal(detailed.postgresql, 'ok'); assert.ok(detailed.serverTime);
  });
  await t.test('valide strictement les variables de production', () => {
    assert.throws(() => validateEnvironment({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/db', SESSION_SECRET: 'your-session-secret', PORT: '3000' }, { production: true }), /SESSION_SECRET/);
    assert.throws(() => validateEnvironment({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/db', SESSION_SECRET: 'a'.repeat(48), SESSION_POOL_MAX: '0', PORT: '3000' }, { production: true }), /SESSION_POOL_MAX/);
    const valid = validateEnvironment({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost/db', SESSION_SECRET: 'a'.repeat(48), PORT: '3000', PUBLIC_APP_URL: 'https://example.org', TRUST_PROXY: '1' }, { production: true });
    assert.equal(valid.production, true);
  });
  await t.test('expurge les secrets des logs et ajoute requestId', () => {
    const safe = logger.sanitize({ password: 'secret', token: 'abc', message: 'ok', nested: { cookie: 'bad', value: 2 } });
    assert.deepEqual(safe, { message: 'ok', nested: { value: 2 } });
    const req = { session: {}, originalUrl: '/test', method: 'GET', ip: '127.0.0.1' };
    const handlers = {}; const res = { setHeader(name, value) { this[name] = value; }, on(name, cb) { handlers[name] = cb; }, statusCode: 200 };
    requestContext(req, res, () => {});
    assert.match(req.requestId, /^[0-9a-f-]{36}$/); assert.equal(res['X-Request-Id'], req.requestId);
  });
  await t.test('masque stack et chemins en production tout en renvoyant requestId', () => {
    let rendered; const req = { requestId: 'request-safe', originalUrl: '/failure', method: 'GET', ip: '127.0.0.1', session: {}, accepts: () => 'html' };
    const res = { headersSent: false, status(code) { this.code = code; return this; }, render(view, data) { rendered = { view, data }; } };
    errorHandler(Object.assign(new Error('SQL at C:\\private\\secret.sql'), { statusCode: 500 }), req, res, () => {});
    assert.equal(res.code, 500); assert.equal(rendered.view, 'errors/500'); assert.equal(rendered.data.requestId, 'request-safe');
    assert.equal(JSON.stringify(rendered).includes('secret.sql'), false);
  });
  await t.test('verrouille les tentatives répétées et réinitialise après succès', () => {
    loginProtection.reset();
    for (let i = 0; i < loginProtection.MAX; i += 1) loginProtection.failed('10.0.0.1', '+243000', `r${i}`);
    assert.throws(() => loginProtection.check('10.0.0.1', '+243000'), /Trop de tentatives/);
    loginProtection.succeeded('10.0.0.1', '+243000');
    assert.doesNotThrow(() => loginProtection.check('10.0.0.1', '+243000'));
  });
  await t.test('exécute un arrêt propre et prépare SIGTERM/SIGINT', async () => {
    const source = await fs.readFile('src/server.js', 'utf8');
    assert.match(source, /SIGTERM/); assert.match(source, /SIGINT/); assert.match(source, /\$disconnect/);
    const previousPort = process.env.PORT; process.env.PORT = '0';
    const serverModule = require('../src/server'); const instance = await serverModule.start();
    await serverModule.shutdown('TEST', { exit: false });
    assert.equal(instance.listening, false);
    process.env.PORT = previousPort;
    assert.equal(await fs.access('scripts/productionCheck.js').then(() => true), true);
  });

  const files = await backups.list();
  for (const item of files) await fs.unlink(`${backups.backupRoot()}/${item.storageKey}`).catch(() => {});
  await prisma.backupAuditLog.deleteMany();
  await prisma.databaseBackup.deleteMany();
  await prisma.systemOperationLock.deleteMany();
  await prisma.backupPolicy.deleteMany();
  await prisma.user.delete({ where: { id: admin.id } });
});
