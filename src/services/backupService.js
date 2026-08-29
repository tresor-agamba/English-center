const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const prisma = require('../utils/prisma');
const { validateEnvironment } = require('../config/environment');
const logger = require('./loggerService');

const LOCK_NAME = 'DATABASE_BACKUP';
class BackupError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const config = () => validateEnvironment();
const backupRoot = () => path.resolve(config().privateRoot, 'backups');
const safePath = (storageKey) => {
  if (!/^[0-9a-f-]{36}\.dump$/.test(storageKey)) throw new BackupError('INVALID_STORAGE_KEY', 'Sauvegarde invalide.', 404);
  const candidate = path.resolve(backupRoot(), storageKey);
  if (!candidate.startsWith(`${backupRoot()}${path.sep}`)) throw new BackupError('INVALID_STORAGE_KEY', 'Sauvegarde invalide.', 404);
  return candidate;
};
async function ensureStorage() {
  const root = backupRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => {});
  return root;
}
function databaseProcessEnv() {
  const url = new URL(config().databaseUrl);
  return {
    args: ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.replace(/^\//, '')],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  };
}
function run(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString().slice(0, 10000); });
    child.stderr.on('data', (data) => { stderr += data.toString().slice(0, 10000); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new BackupError('POSTGRES_COMMAND_FAILED', `Commande PostgreSQL échouée (${code}). ${stderr}`)));
  });
}
async function checksum(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close().catch(() => {}); }
  return hash.digest('hex');
}
async function acquireLock(name = LOCK_NAME, ttlMinutes = 60) {
  const ownerToken = crypto.randomUUID(), now = new Date(), expiresAt = new Date(now.getTime() + ttlMinutes * 60000);
  return prisma.$transaction(async (tx) => {
    await tx.systemOperationLock.deleteMany({ where: { name, expiresAt: { lt: now } } });
    try { await tx.systemOperationLock.create({ data: { name, ownerToken, expiresAt } }); } catch (error) {
      if (error.code === 'P2002') throw new BackupError('OPERATION_LOCKED', 'Une opération critique est déjà en cours.', 409);
      throw error;
    }
    return ownerToken;
  });
}
const releaseLock = (name, ownerToken) => prisma.systemOperationLock.deleteMany({ where: { name, ownerToken } });
async function audit(action, result, { backupId, actorId, requestId, ipAddress, details } = {}) {
  await prisma.backupAuditLog.create({ data: { action, result, backupId, actorId: actorId || null, requestId, ipAddress, details } }).catch((error) => logger.error('BACKUP_AUDIT_FAILED', { action, error }));
  logger.audit(`BACKUP_${action}`, { result, backupId, actorId, requestId, ipAddress });
}
async function checkDiskSpace() {
  const root = await ensureStorage();
  if (typeof fs.statfs !== 'function') return { availableBytes: null };
  const stats = await fs.statfs(root);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (availableBytes < 100 * 1024 * 1024) throw new BackupError('DISK_SPACE_LOW', 'Espace disque insuffisant.', 503);
  return { availableBytes };
}
async function postgresVersion() {
  const { args, env } = databaseProcessEnv();
  try { return (await run(config().pgDumpPath, ['--version'], { env })).stdout.trim().slice(0, 120) || null; } catch { return null; }
}
async function defaultDumpRunner(target) {
  const { args, env } = databaseProcessEnv();
  await run(config().pgDumpPath, [...args, '--format=custom', '--no-owner', '--no-privileges', '--exclude-table=http_sessions', '--file', target], { env });
}
async function createBackup({ actorId = null, type = 'MANUAL', requestId, ipAddress, dumpRunner = defaultDumpRunner } = {}) {
  if (!['MANUAL', 'SCHEDULED', 'PRE_RESTORE'].includes(type)) throw new BackupError('INVALID_TYPE', 'Type de sauvegarde invalide.');
  const ownerToken = await acquireLock();
  const storageKey = `${crypto.randomUUID()}.dump`, target = safePath(storageKey), partial = `${target}.partial`;
  let record;
  try {
    await checkDiskSpace();
    record = await prisma.databaseBackup.create({ data: { storageKey, type, status: 'PENDING', createdById: actorId } });
    await prisma.databaseBackup.update({ where: { id: record.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    await audit('CREATE_STARTED', 'RUNNING', { backupId: record.id, actorId, requestId, ipAddress });
    await dumpRunner(partial);
    const stat = await fs.stat(partial);
    if (!stat.isFile() || stat.size <= 5) throw new BackupError('EMPTY_BACKUP', 'Le fichier de sauvegarde est vide ou invalide.');
    if (stat.size > config().backupMaxBytes) throw new BackupError('BACKUP_TOO_LARGE', 'La sauvegarde dépasse la taille maximale.');
    const header = Buffer.alloc(5); const handle = await fs.open(partial, 'r'); await handle.read(header, 0, 5, 0); await handle.close();
    if (header.toString() !== 'PGDMP') throw new BackupError('INVALID_DUMP_HEADER', 'Format de sauvegarde PostgreSQL invalide.');
    const digest = await checksum(partial);
    await fs.rename(partial, target); await fs.chmod(target, 0o600).catch(() => {});
    record = await prisma.databaseBackup.update({ where: { id: record.id }, data: { status: 'COMPLETED', sizeBytes: BigInt(stat.size), checksumSha256: digest, postgresVersion: await postgresVersion(), completedAt: new Date() } });
    await audit('CREATE_COMPLETED', 'SUCCESS', { backupId: record.id, actorId, requestId, ipAddress, details: { sizeBytes: String(stat.size), checksum: digest } });
    return record;
  } catch (error) {
    await fs.unlink(partial).catch(() => {}); await fs.unlink(target).catch(() => {});
    if (record) await prisma.databaseBackup.update({ where: { id: record.id }, data: { status: 'FAILED', errorMessage: String(error.message).slice(0, 1000) } }).catch(() => {});
    await audit('CREATE_FAILED', 'FAILED', { backupId: record?.id, actorId, requestId, ipAddress, details: { code: error.code || 'ERROR' } });
    throw error;
  } finally { await releaseLock(LOCK_NAME, ownerToken).catch(() => {}); }
}
async function verifyBackup(id, context = {}) {
  const backup = await prisma.databaseBackup.findFirst({ where: { id: String(id), status: 'COMPLETED', deletedAt: null } });
  if (!backup) throw new BackupError('NOT_FOUND', 'Sauvegarde introuvable.', 404);
  const target = safePath(backup.storageKey);
  let valid = false, reason = null;
  try {
    const stat = await fs.stat(target); if (!stat.isFile() || stat.size <= 5 || BigInt(stat.size) !== backup.sizeBytes) throw new Error('Taille invalide');
    const header = Buffer.alloc(5); const handle = await fs.open(target, 'r'); await handle.read(header, 0, 5, 0); await handle.close();
    if (header.toString() !== 'PGDMP') throw new Error('En-tête invalide');
    if (await checksum(target) !== backup.checksumSha256) throw new Error('Checksum invalide');
    if (context.runPgRestoreList !== false) {
      try { await run(config().pgRestorePath, ['--list', target], { env: process.env }); } catch (error) { if (context.requirePgRestore) throw error; }
    }
    valid = true;
  } catch (error) { reason = String(error.message).slice(0, 500); }
  const updated = await prisma.databaseBackup.update({ where: { id: backup.id }, data: { verificationStatus: valid ? 'VALID' : 'INVALID', lastVerifiedAt: new Date(), errorMessage: valid ? null : reason } });
  await audit('VERIFY', valid ? 'VALID' : 'INVALID', { backupId: backup.id, ...context });
  if (!valid) throw new BackupError('INVALID_BACKUP', 'La sauvegarde a échoué à la vérification.', 422);
  return updated;
}
async function getDownload(id, context = {}) {
  const backup = await prisma.databaseBackup.findFirst({ where: { id: String(id), status: 'COMPLETED', deletedAt: null } });
  if (!backup) throw new BackupError('NOT_FOUND', 'Sauvegarde introuvable.', 404);
  const absolutePath = safePath(backup.storageKey);
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat?.isFile()) throw new BackupError('NOT_FOUND', 'Fichier de sauvegarde introuvable.', 404);
  await audit('DOWNLOAD', 'SUCCESS', { backupId: backup.id, ...context });
  return { backup, absolutePath, downloadName: `english-center-backup-${backup.createdAt.toISOString().slice(0, 10)}.dump` };
}
async function logicalDelete(id, context = {}) {
  const backup = await prisma.databaseBackup.findFirst({ where: { id: String(id), status: { in: ['COMPLETED', 'FAILED'] }, deletedAt: null } });
  if (!backup) throw new BackupError('NOT_FOUND', 'Sauvegarde introuvable.', 404);
  await fs.unlink(safePath(backup.storageKey)).catch(() => {});
  const updated = await prisma.databaseBackup.update({ where: { id: backup.id }, data: { status: 'DELETED', deletedAt: new Date() } });
  await audit('DELETE', 'SUCCESS', { backupId: backup.id, ...context }); return updated;
}
async function getPolicy() { return prisma.backupPolicy.upsert({ where: { id: 'MAIN' }, create: { id: 'MAIN' }, update: {} }); }
async function updatePolicy(body) {
  const retentionDays = Number(body.retentionDays), maxBackups = Number(body.maxBackups), dailyBackupTime = String(body.dailyBackupTime || '');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650 || !Number.isInteger(maxBackups) || maxBackups < 1 || maxBackups > 1000 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dailyBackupTime)) throw new BackupError('INVALID_POLICY', 'Politique de rétention invalide.');
  return prisma.backupPolicy.upsert({ where: { id: 'MAIN' }, create: { id: 'MAIN', retentionDays, maxBackups, autoCleanup: body.autoCleanup === true || body.autoCleanup === 'on', dailyBackup: body.dailyBackup === true || body.dailyBackup === 'on', dailyBackupTime }, update: { retentionDays, maxBackups, autoCleanup: body.autoCleanup === true || body.autoCleanup === 'on', dailyBackup: body.dailyBackup === true || body.dailyBackup === 'on', dailyBackupTime } });
}
async function cleanup(context = {}) {
  const policy = await getPolicy(), cutoff = new Date(Date.now() - policy.retentionDays * 86400000);
  const completed = await prisma.databaseBackup.findMany({ where: { status: 'COMPLETED', deletedAt: null }, orderBy: { createdAt: 'desc' } });
  const remove = completed.filter((item, index) => item.createdAt < cutoff || index >= policy.maxBackups);
  const incomplete = await prisma.databaseBackup.findMany({ where: { status: { in: ['PENDING', 'RUNNING', 'FAILED'] }, createdAt: { lt: new Date(Date.now() - 3600000) }, deletedAt: null } });
  for (const item of [...remove, ...incomplete]) await logicalDelete(item.id, context);
  const root = await ensureStorage(); for (const name of await fs.readdir(root)) if (name.endsWith('.partial')) await fs.unlink(path.join(root, name)).catch(() => {});
  await audit('CLEANUP', 'SUCCESS', { ...context, details: { removed: remove.length + incomplete.length } });
  return { removed: remove.length + incomplete.length };
}
async function list() { return prisma.databaseBackup.findMany({ include: { createdBy: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }); }
async function restoreBackup(id, { confirmation, actorId, requestId, ipAddress } = {}) {
  const cfg = config();
  if (!cfg.restoreEnabled || !cfg.restoreConfirmation || confirmation !== cfg.restoreConfirmation) throw new BackupError('RESTORE_DISABLED', 'Restauration désactivée ou confirmation invalide.', 403);
  const restoreLock = await acquireLock('DATABASE_RESTORE', 120);
  try {
    const activeBackup = await prisma.systemOperationLock.findFirst({ where: { name: LOCK_NAME, expiresAt: { gt: new Date() } } });
    if (activeBackup) throw new BackupError('OPERATION_LOCKED', 'Une sauvegarde est déjà en cours.', 409);
    await verifyBackup(id, { actorId, requestId, ipAddress, requirePgRestore: true });
    await createBackup({ actorId, type: 'PRE_RESTORE', requestId, ipAddress });
    const backup = await prisma.databaseBackup.findUnique({ where: { id: String(id) } });
    const { args, env } = databaseProcessEnv();
    await audit('RESTORE_STARTED', 'RUNNING', { backupId: backup.id, actorId, requestId, ipAddress });
    await run(cfg.pgRestorePath, [...args, '--clean', '--if-exists', '--no-owner', '--exit-on-error', safePath(backup.storageKey)], { env });
    await audit('RESTORE_COMPLETED', 'SUCCESS', { backupId: backup.id, actorId, requestId, ipAddress });
  } finally { await releaseLock('DATABASE_RESTORE', restoreLock).catch(() => {}); }
}
module.exports = { BackupError, backupRoot, ensureStorage, checksum, acquireLock, releaseLock, createBackup, verifyBackup, getDownload, logicalDelete, getPolicy, updatePolicy, cleanup, list, restoreBackup, checkDiskSpace, postgresVersion };
