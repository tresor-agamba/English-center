require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const prisma = require('../src/utils/prisma');
const settings = require('../src/services/centerSettingsService');
const requireAdmin = require('../src/middlewares/requireAdmin');

const key = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
let admin;
const meta = { ipAddress: '127.0.0.1', userAgent: 'phase-9-test', reason: 'Test automatisé' };
test('Phase 9 — paramètres centralisés du centre', async (t) => {
  admin = await prisma.user.create({ data: { firstName: 'Admin', lastName: 'Settings', phoneNumber: `+243899${key}`, passwordHash: 'x', role: 'ADMIN' } });
  await prisma.centerSettingsAudit.deleteMany();
  await prisma.privateSettingFile.deleteMany();
  await prisma.centerSettings.deleteMany();

  await t.test('charge des valeurs sûres et crée le singleton MAIN', async () => {
    const fallback = await settings.getCenterSettings({ create: false });
    assert.equal(fallback.id, 'MAIN'); assert.equal(fallback.timezone, 'Africa/Kinshasa');
    const created = await settings.ensureSettings();
    assert.equal(created.id, 'MAIN');
    assert.equal(await prisma.centerSettings.count(), 1);
    await assert.rejects(() => prisma.centerSettings.create({ data: { id: 'OTHER' } }));
  });
  await t.test('met à jour le général, le fuseau et audite', async () => {
    const before = await settings.getCenterSettings();
    await settings.updateGeneralSettings({
      ...before, officialName: 'Centre Anglais Kinshasa', primaryLanguage: 'fr', primaryCurrency: 'USD',
      timezone: 'Africa/Lubumbashi', isActive: true,
    }, admin.id, meta);
    const current = await settings.getCenterSettings();
    assert.equal(current.officialName, 'Centre Anglais Kinshasa'); assert.equal(current.timezone, 'Africa/Lubumbashi');
    assert.throws(() => settings.updateGeneralSettings({ ...current, timezone: 'Mars/Olympus' }, admin.id), /Fuseau/);
  });
  await t.test('valide les couleurs', async () => {
    await settings.updateBrandingSettings({ primaryColor: '#112233', secondaryColor: '#445566', accentColor: '#AABBCC' }, admin.id, meta);
    assert.equal((await settings.getCenterSettings()).primaryColor, '#112233');
    assert.throws(() => settings.updateBrandingSettings({ primaryColor: 'red', secondaryColor: '#445566', accentColor: '#AABBCC' }, admin.id), /Couleur/);
  });
  await t.test('configure académique et niveaux sans rétroactivité', async () => {
    await settings.updateAcademicSettings({
      defaultCohortCapacity: 40, defaultGroupCapacity: 18, defaultSessionMinutes: 90,
      usualStartTime: '08:30', usualEndTime: '17:30', openingDays: ['MONDAY', 'SATURDAY'],
      defaultTrainingMode: 'HYBRID', toleratedLateMinutes: 10, onlineCoursesEnabled: true,
      inPersonCoursesEnabled: true, hybridCoursesEnabled: true,
      levels: settings.LEVELS.map((level, i) => ({ level, displayName: `Niveau ${i + 1}`, indicativeWeeks: 12, isActive: true, displayOrder: i + 1 })),
    }, admin.id, meta);
    const current = await settings.getCenterSettings();
    assert.equal(current.defaultCohortCapacity, 40); assert.equal(current.defaultGroupCapacity, 18);
    assert.equal(await prisma.centerLevelSettings.count(), 3);
    await assert.rejects(() => settings.updateLevelSettings([{ level: 'LEVEL_4' }], admin.id), /trois niveaux/);
  });
  await t.test('configure finances et génère des numéros uniques en concurrence', async () => {
    const current = await settings.getCenterSettings();
    await settings.updateFinanceSettings({ ...current, primaryCurrency: 'CDF', invoicePrefix: 'FAC', receiptPrefix: 'RCU', nextInvoiceNumber: 100, nextReceiptNumber: 500 }, admin.id, meta);
    const invoices = await Promise.all(Array.from({ length: 20 }, () => settings.getNextInvoiceNumber()));
    const receipts = await Promise.all(Array.from({ length: 20 }, () => settings.getNextReceiptNumber()));
    assert.equal(new Set(invoices).size, 20); assert.equal(new Set(receipts).size, 20);
    assert.ok(invoices.includes('FAC-000100')); assert.ok(receipts.includes('RCU-000500'));
  });
  await t.test('configure certificats, LMS, évaluations, présences et documents', async () => {
    await settings.updateCertificateSettings({ certificatesEnabled: true, certificateSignerName: 'Jane Doe', certificateSignerTitle: 'Directrice', certificateIntroText: 'Atteste que', certificateValidationText: 'a réussi', certificateIssuePlace: 'Kinshasa', certificateNumberFormat: 'CERT-{YEAR}-{NUMBER}', certificateShowVerificationCode: true, certificateShowLogo: true }, admin.id, meta);
    await settings.updateLmsSettings({ lmsEnabled: true, lmsProgressionMode: 'REQUIRED', lmsMaxTrackedMinutesPerAction: 20, lmsRequirePreviousLesson: true, lmsDownloadsEnabled: true, lmsAutoResumeEnabled: true, lmsTimeTrackingEnabled: true }, admin.id, meta);
    await settings.updateAssessmentSettings({ writtenAssessmentsEnabled: true, recordedOralAssessmentsEnabled: true, liveVideoOralAssessmentsEnabled: false, defaultMaximumScore: 100, defaultPassingScore: 60, defaultWrittenDurationMinutes: 45, maxAudioFileSizeMb: 20, allowedVideoPlatforms: ['ZOOM'], automaticResultPublication: false, showEvaluatorComment: true }, admin.id, meta);
    await settings.updateAttendanceSettings({ attendanceLateMinutes: 12, attendanceCorrectionEnabled: true, attendanceCorrectionMaxHours: 24, attendanceCorrectionReasonRequired: true, attendanceTechnicalIssueEnabled: true, attendanceExcusedEnabled: true }, admin.id, meta);
    await settings.updateDocumentSettings({ documentShowLogo: true, documentShowCenterName: true, documentShowAddress: true, documentShowPhone: true, documentShowEmail: true, documentShowCurrency: true, documentFooter: 'Pied', documentThankYouText: 'Merci' }, admin.id, meta);
    assert.equal((await settings.getCenterSettings()).certificateSignerName, 'Jane Doe');
  });
  await t.test('stocke une signature privée validée et protège les identifiants', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const saved = await settings.storePrivateFile({ buffer: png, size: png.length, mimetype: 'image/png', originalname: 'signature.png' }, 'CERTIFICATE_SIGNATURE', admin.id, meta);
    const found = await settings.getPrivateFile(saved.id);
    assert.equal(found.file.mimeType, 'image/png'); assert.ok(!found.file.storageKey.includes('signature'));
    await assert.rejects(() => settings.getPrivateFile(saved.id + 999999), /introuvable/);
    await assert.rejects(() => settings.storePrivateFile({ buffer: Buffer.from('bad'), size: 3, mimetype: 'image/svg+xml', originalname: 'bad.svg' }, 'MAIN_LOGO', admin.id), /Format|Extension/);
    await fs.unlink(found.absolutePath);
  });
  await t.test('n’expose aucune donnée privée dans les paramètres publics ou l’audit', async () => {
    const publicData = await settings.getPublicCenterSettings();
    assert.equal(publicData.officialName, 'Centre Anglais Kinshasa');
    assert.equal('certificateSignatureFileId' in publicData, false);
    const history = await settings.getHistory({ pageSize: 100 });
    assert.ok(history.length > 0);
    assert.equal(JSON.stringify(history).includes('iVBOR'), false);
    assert.ok(history.some((row) => row.field === 'CERTIFICATE_SIGNATURE'));
  });
  await t.test('refuse les rôles enseignant et étudiant sur les routes admin', () => {
    for (const role of ['TEACHER', 'STUDENT']) {
      let received;
      requireAdmin({ session: { user: { role } } }, {}, (error) => { received = error; });
      assert.equal(received.statusCode, 403);
    }
  });

  await prisma.centerSettingsAudit.deleteMany({ where: { actorId: admin.id } });
  await prisma.centerSettings.update({ where: { id: 'MAIN' }, data: { updatedById: null, certificateSignatureFileId: null } });
  await prisma.privateSettingFile.deleteMany({ where: { uploadedById: admin.id } });
  await prisma.user.delete({ where: { id: admin.id } });
});
