const fs = require('fs/promises');
const prisma = require('../utils/prisma');
const backupService = require('./backupService');
const pkg = require('../../package.json');
async function publicHealth() { return { status: 'ok' }; }
async function readiness() {
  try { await prisma.$queryRaw`SELECT 1`; return { status: 'ok' }; }
  catch { return { status: 'unavailable' }; }
}
async function detailedHealth() {
  const result = { status: 'ok', application: 'ok', postgresql: 'unknown', privateStorage: 'unknown', disk: {}, version: pkg.version, serverTime: new Date().toISOString(), environment: process.env.NODE_ENV || 'development', lastSuccessfulBackup: null };
  try { await prisma.$queryRaw`SELECT 1`; result.postgresql = 'ok'; } catch { result.postgresql = 'unavailable'; result.status = 'degraded'; }
  try {
    const root = await backupService.ensureStorage(); await fs.access(root, fs.constants?.R_OK | fs.constants?.W_OK); result.privateStorage = 'ok';
    result.disk = await backupService.checkDiskSpace();
  } catch { result.privateStorage = 'unavailable'; result.status = 'degraded'; }
  try { const last = await prisma.databaseBackup.findFirst({ where: { status: 'COMPLETED', deletedAt: null }, orderBy: { completedAt: 'desc' }, select: { id: true, completedAt: true, verificationStatus: true } }); result.lastSuccessfulBackup = last; } catch {}
  return result;
}
module.exports = { publicHealth, readiness, detailedHealth };
