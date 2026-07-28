const path = require('path');
const service = require('../services/centerSettingsService');
const meta = (req) => ({ ipAddress: req.ip, userAgent: req.get('user-agent'), reason: req.body?.reason });
async function index(req, res) {
  res.render('admin/settings/index', { title: 'Paramètres du centre', activeTab: String(req.query.tab || 'general'), success: req.query.success === '1', ...(await service.getAdminView()), ...service });
}
const updater = (method, tab) => async (req, res) => {
  await service[method](req.body, req.session.user.id, meta(req));
  res.redirect(`/admin/settings?tab=${encodeURIComponent(tab)}&success=1`);
};
async function academic(req, res) {
  const levels = service.LEVELS.map((level) => ({
    level, displayName: req.body[`level_${level}_displayName`], description: req.body[`level_${level}_description`],
    indicativeWeeks: req.body[`level_${level}_indicativeWeeks`], isActive: req.body[`level_${level}_isActive`],
    displayOrder: req.body[`level_${level}_displayOrder`],
  }));
  await service.updateAcademicSettings({ ...req.body, levels }, req.session.user.id, meta(req));
  res.redirect('/admin/settings?tab=academic&success=1');
}
async function upload(req, res) {
  await service.storePrivateFile(req.file, req.body.category, req.session.user.id, meta(req));
  res.redirect('/admin/settings?tab=branding&success=1');
}
async function download(req, res) {
  const { file, absolutePath } = await service.getPrivateFile(req.params.id);
  res.type(file.mimeType).setHeader('Content-Disposition', `${req.query.preview === '1' ? 'inline' : 'attachment'}; filename="setting-${file.id}.${file.extension}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(path.basename(absolutePath), { root: path.dirname(absolutePath), dotfiles: 'deny' });
}
async function publicLogo(req, res) {
  const { file, absolutePath } = await service.getPublicLogo(req.params.kind);
  res.type(file.mimeType).setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.basename(absolutePath), { root: path.dirname(absolutePath), dotfiles: 'deny' });
}
async function history(req, res) { res.json({ items: await service.getHistory(req.query) }); }
async function publicSettings(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(await service.getPublicCenterSettings());
}
module.exports = {
  index, general: updater('updateGeneralSettings', 'general'), branding: updater('updateBrandingSettings', 'branding'),
  academic, finance: updater('updateFinanceSettings', 'finance'), certificates: updater('updateCertificateSettings', 'certificates'),
  lms: updater('updateLmsSettings', 'lms'), assessments: updater('updateAssessmentSettings', 'assessments'),
  attendance: updater('updateAttendanceSettings', 'attendance'), documents: updater('updateDocumentSettings', 'documents'),
  upload, download, history, publicSettings, publicLogo,
};
