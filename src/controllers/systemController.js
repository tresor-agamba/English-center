const path = require('path');
const backupService = require('../services/backupService');
const healthService = require('../services/systemHealthService');
const context = (req) => ({ actorId: req.session?.user?.id, requestId: req.requestId, ipAddress: req.ip });
async function publicHealth(req, res) { res.json(await healthService.publicHealth()); }
async function readiness(req, res) { const data = await healthService.readiness(); res.status(data.status === 'ok' ? 200 : 503).json(data); }
async function health(req, res) { const data = await healthService.detailedHealth(); res.status(data.status === 'ok' ? 200 : 503).json(data); }
async function backups(req, res) {
  const [items, policy] = await Promise.all([backupService.list(), backupService.getPolicy()]);
  res.render('admin/system/backups', { title: 'Sauvegardes PostgreSQL', items, policy, success: req.query.success || '' });
}
async function create(req, res) { await backupService.createBackup(context(req)); res.redirect('/admin/system/backups?success=created'); }
async function verify(req, res) { await backupService.verifyBackup(req.params.id, context(req)); res.redirect('/admin/system/backups?success=verified'); }
async function download(req, res) {
  const item = await backupService.getDownload(req.params.id, context(req));
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${item.downloadName}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.sendFile(path.basename(item.absolutePath), { root: path.dirname(item.absolutePath), dotfiles: 'deny' });
}
async function remove(req, res) { await backupService.logicalDelete(req.params.id, context(req)); res.redirect('/admin/system/backups?success=deleted'); }
async function cleanup(req, res) { await backupService.cleanup(context(req)); res.redirect('/admin/system/backups?success=cleanup'); }
async function policy(req, res) { await backupService.updatePolicy(req.body); res.redirect('/admin/system/backups?success=policy'); }
async function restore(req, res) { await backupService.restoreBackup(req.params.id, { ...context(req), confirmation: req.body.confirmation }); res.redirect('/admin/system/backups?success=restored'); }
module.exports = { publicHealth, readiness, health, backups, create, verify, download, remove, cleanup, policy, restore };
