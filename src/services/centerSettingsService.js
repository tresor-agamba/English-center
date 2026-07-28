const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Prisma } = require('@prisma/client');
const prisma = require('../utils/prisma');

const MAIN_ID = 'MAIN';
const PRIVATE_ROOT = path.resolve(__dirname, '..', '..', 'storage', 'private', 'settings');
const CURRENCIES = ['USD', 'CDF'];
const LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3'];
const MODES = ['ONLINE', 'IN_PERSON', 'HYBRID'];
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const PLATFORMS = ['GOOGLE_MEET', 'ZOOM', 'MICROSOFT_TEAMS', 'JITSI', 'OTHER'];
const FILE_CATEGORIES = ['MAIN_LOGO', 'SECONDARY_LOGO', 'FAVICON', 'CERTIFICATE_SIGNATURE', 'CERTIFICATE_STAMP', 'DOCUMENT_SIGNATURE', 'DOCUMENT_STAMP', 'ADMIN_DOCUMENT'];
const FILE_FIELDS = {
  MAIN_LOGO: 'mainLogoFileId', SECONDARY_LOGO: 'secondaryLogoFileId', FAVICON: 'faviconFileId',
  CERTIFICATE_SIGNATURE: 'certificateSignatureFileId', CERTIFICATE_STAMP: 'certificateStampFileId',
  DOCUMENT_SIGNATURE: 'documentSignatureFileId', DOCUMENT_STAMP: 'documentStampFileId',
};
const ALLOWED_IMAGES = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
};
const DEFAULTS = Object.freeze({
  id: MAIN_ID, officialName: 'English Center', shortName: null, description: null, address: null,
  city: 'Kinshasa', country: 'RDC', primaryPhone: null, secondaryPhone: null, email: null,
  website: null, timezone: 'Africa/Kinshasa', primaryLanguage: 'fr', primaryCurrency: 'USD',
  isActive: true, mainLogoFileId: null, secondaryLogoFileId: null, faviconFileId: null,
  primaryColor: '#1D4ED8', secondaryColor: '#173B57', accentColor: '#C9A95E',
  defaultCohortCapacity: 30, defaultGroupCapacity: 20, defaultSessionMinutes: 60,
  usualStartTime: '08:00', usualEndTime: '17:00', openingDays: DAYS.slice(0, 5),
  defaultTrainingMode: 'IN_PERSON', toleratedLateMinutes: 15,
  onlineCoursesEnabled: true, inPersonCoursesEnabled: true, hybridCoursesEnabled: true,
  invoicePrefix: 'INV', receiptPrefix: 'REC', nextInvoiceNumber: 1n, nextReceiptNumber: 1n,
  trainingFeesEnabled: true, syllabusFeesEnabled: true, certificateFeesEnabled: true,
  showBalanceOnReceipts: true, showPaymentMethod: true, showPaymentReference: true,
  certificatesEnabled: true, certificateSignerName: 'Direction English Center', certificateSignerTitle: 'Direction',
  certificateIntroText: 'Le présent certificat atteste que', certificateValidationText: 'a suivi avec succès la formation',
  certificateIssuePlace: 'Kinshasa', certificateNumberFormat: 'CERT-{YEAR}-{NUMBER}',
  certificateShowVerificationCode: true, certificateShowLogo: true,
  documentShowLogo: true, documentShowCenterName: true, documentShowAddress: true,
  documentShowPhone: true, documentShowEmail: true, documentShowCurrency: true,
  documentFooter: null, documentThankYouText: 'Merci pour votre confiance.',
  lmsEnabled: true, lmsProgressionMode: 'FREE', lmsMaxTrackedMinutesPerAction: 30,
  lmsRequirePreviousLesson: false, lmsDownloadsEnabled: true, lmsAutoResumeEnabled: true,
  lmsTimeTrackingEnabled: true, studentWelcomeMessage: null, teacherWelcomeMessage: null,
  writtenAssessmentsEnabled: true, recordedOralAssessmentsEnabled: true, liveVideoOralAssessmentsEnabled: true,
  defaultMaximumScore: new Prisma.Decimal(100), defaultPassingScore: new Prisma.Decimal(50),
  defaultWrittenDurationMinutes: 60, maxAudioFileSizeMb: 25, allowedVideoPlatforms: PLATFORMS.slice(0, 4),
  automaticResultPublication: false, showEvaluatorComment: true, attendanceLateMinutes: 15,
  attendanceCorrectionEnabled: true, attendanceCorrectionMaxHours: 48,
  attendanceCorrectionReasonRequired: true, attendanceTechnicalIssueEnabled: true, attendanceExcusedEnabled: true,
});

class SettingsError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const bool = (value) => value === true || value === 'true' || value === '1' || value === 'on';
const text = (value, max = 500, required = false) => {
  const result = String(value ?? '').trim();
  if (required && !result) throw new SettingsError('REQUIRED', 'Un champ obligatoire est vide.');
  if (result.length > max) throw new SettingsError('TOO_LONG', `La valeur dépasse ${max} caractères.`);
  return result || null;
};
const integer = (value, min, max, label) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result < min || result > max) throw new SettingsError('INVALID_NUMBER', `${label} est invalide.`);
  return result;
};
const enumValue = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new SettingsError('INVALID_ENUM', `${label} est invalide.`);
  return value;
};
const color = (value) => {
  const result = String(value || '').toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(result)) throw new SettingsError('INVALID_COLOR', 'Couleur hexadécimale invalide.');
  return result;
};
const time = (value) => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new SettingsError('INVALID_TIME', 'Heure invalide.');
  return String(value);
};
const timezone = (value) => {
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: value }).format(); } catch { throw new SettingsError('INVALID_TIMEZONE', 'Fuseau horaire invalide.'); }
  return String(value);
};
const email = (value) => {
  const result = text(value, 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new SettingsError('INVALID_EMAIL', 'Adresse email invalide.');
  return result;
};
const phone = (value) => {
  const result = text(value, 30);
  if (result && !/^\+?[0-9][0-9 ()-]{6,28}$/.test(result)) throw new SettingsError('INVALID_PHONE', 'Numéro de téléphone invalide.');
  return result;
};
const url = (value) => {
  const result = text(value, 300);
  if (!result) return null;
  try { const parsed = new URL(result); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); } catch { throw new SettingsError('INVALID_URL', 'Adresse web invalide.'); }
  return result;
};
const list = (value, allowed, label) => {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  if (!values.length || values.some((item) => !allowed.includes(item))) throw new SettingsError('INVALID_LIST', `${label} invalide.`);
  return [...new Set(values)];
};
const auditValue = (value) => typeof value === 'bigint' ? value.toString() : value instanceof Prisma.Decimal ? value.toString() : value;
const requestMeta = (meta = {}) => ({
  ipAddress: text(meta.ipAddress, 100), userAgent: text(meta.userAgent, 500), reason: text(meta.reason, 500),
});

async function ensureSettings(client = prisma) {
  return client.centerSettings.upsert({ where: { id: MAIN_ID }, update: {}, create: { id: MAIN_ID } });
}
async function ensureLevels(client = prisma) {
  await Promise.all(LEVELS.map((level, index) => client.centerLevelSettings.upsert({
    where: { level }, update: {}, create: { level, displayName: `Level ${index + 1}`, displayOrder: index + 1 },
  })));
}
async function getCenterSettings({ create = true, client = prisma } = {}) {
  const settings = await client.centerSettings.findUnique({ where: { id: MAIN_ID } });
  if (!settings && create) return ensureSettings(client);
  return settings || { ...DEFAULTS };
}
async function getPublicCenterSettings() {
  const settings = await getCenterSettings();
  return {
    officialName: settings.officialName, shortName: settings.shortName, description: settings.description,
    city: settings.city, country: settings.country, primaryPhone: settings.primaryPhone, email: settings.email,
    website: settings.website, timezone: settings.timezone, primaryLanguage: settings.primaryLanguage,
    primaryCurrency: settings.primaryCurrency, isActive: settings.isActive,
    mainLogoUrl: settings.mainLogoFileId ? '/settings/public/logo/main' : null,
    primaryColor: settings.primaryColor, secondaryColor: settings.secondaryColor, accentColor: settings.accentColor,
    lmsEnabled: settings.lmsEnabled, studentWelcomeMessage: settings.studentWelcomeMessage,
    teacherWelcomeMessage: settings.teacherWelcomeMessage,
  };
}
async function getPublicLogo(kind) {
  const field = { main: 'mainLogoFileId', secondary: 'secondaryLogoFileId', favicon: 'faviconFileId' }[kind];
  if (!field) throw new SettingsError('FILE_NOT_FOUND', 'Fichier introuvable.', 404);
  const current = await getCenterSettings();
  if (!current[field]) throw new SettingsError('FILE_NOT_FOUND', 'Fichier introuvable.', 404);
  return getPrivateFile(current[field]);
}
async function auditChanges(tx, category, before, data, actorId, meta) {
  const safeMeta = requestMeta(meta);
  for (const [field, value] of Object.entries(data)) {
    const oldValue = auditValue(before[field]), newValue = auditValue(value);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) await tx.centerSettingsAudit.create({
      data: { category, field, oldValue: oldValue === undefined ? Prisma.JsonNull : oldValue, newValue: newValue === undefined ? Prisma.JsonNull : newValue, actorId: integer(actorId, 1, 2147483647, 'Administrateur'), ...safeMeta },
    });
  }
}
async function update(category, data, actorId, meta = {}) {
  return prisma.$transaction(async (tx) => {
    const before = await ensureSettings(tx);
    const updated = await tx.centerSettings.update({ where: { id: MAIN_ID }, data: { ...data, updatedById: Number(actorId) } });
    await auditChanges(tx, category, before, data, actorId, meta);
    return updated;
  });
}
const updateGeneralSettings = (body, actorId, meta) => update('GENERAL', {
  officialName: text(body.officialName, 160, true), shortName: text(body.shortName, 80),
  description: text(body.description, 2000), address: text(body.address, 300), city: text(body.city, 100),
  country: text(body.country, 100), primaryPhone: phone(body.primaryPhone), secondaryPhone: phone(body.secondaryPhone),
  email: email(body.email), website: url(body.website), timezone: timezone(body.timezone),
  primaryLanguage: enumValue(body.primaryLanguage, ['fr', 'en'], 'Langue'),
  primaryCurrency: enumValue(body.primaryCurrency, CURRENCIES, 'Devise'), isActive: bool(body.isActive),
}, actorId, meta);
const updateBrandingSettings = (body, actorId, meta) => update('BRANDING', {
  primaryColor: color(body.primaryColor), secondaryColor: color(body.secondaryColor), accentColor: color(body.accentColor),
}, actorId, meta);
const updateAcademicSettings = async (body, actorId, meta) => {
  const settings = await update('ACADEMIC', {
    defaultCohortCapacity: integer(body.defaultCohortCapacity, 1, 10000, 'Capacité de cohorte'),
    defaultGroupCapacity: integer(body.defaultGroupCapacity, 1, 10000, 'Capacité de groupe'),
    defaultSessionMinutes: integer(body.defaultSessionMinutes, 5, 1440, 'Durée de séance'),
    usualStartTime: time(body.usualStartTime), usualEndTime: time(body.usualEndTime),
    openingDays: list(body.openingDays, DAYS, 'Jours d’ouverture'),
    defaultTrainingMode: enumValue(body.defaultTrainingMode, MODES, 'Mode de formation'),
    toleratedLateMinutes: integer(body.toleratedLateMinutes, 0, 1440, 'Délai de retard'),
    onlineCoursesEnabled: bool(body.onlineCoursesEnabled), inPersonCoursesEnabled: bool(body.inPersonCoursesEnabled),
    hybridCoursesEnabled: bool(body.hybridCoursesEnabled),
  }, actorId, meta);
  if (Array.isArray(body.levels)) await updateLevelSettings(body.levels, actorId, meta);
  return settings;
};
async function updateLevelSettings(levels, actorId, meta = {}) {
  if (levels.length !== 3 || new Set(levels.map((x) => x.level)).size !== 3 || levels.some((x) => !LEVELS.includes(x.level))) throw new SettingsError('INVALID_LEVELS', 'Les trois niveaux techniques sont obligatoires.');
  return prisma.$transaction(async (tx) => {
    await ensureLevels(tx);
    for (const row of levels) {
      const before = await tx.centerLevelSettings.findUnique({ where: { level: row.level } });
      const data = { displayName: text(row.displayName, 100, true), description: text(row.description, 1000), indicativeWeeks: row.indicativeWeeks ? integer(row.indicativeWeeks, 1, 520, 'Durée indicative') : null, isActive: bool(row.isActive), displayOrder: integer(row.displayOrder, 1, 3, 'Ordre') };
      await tx.centerLevelSettings.update({ where: { level: row.level }, data });
      for (const [field, value] of Object.entries(data)) if (JSON.stringify(before[field]) !== JSON.stringify(value)) await tx.centerSettingsAudit.create({ data: { category: 'ACADEMIC_LEVEL', field: `${row.level}.${field}`, oldValue: before[field] ?? Prisma.JsonNull, newValue: value ?? Prisma.JsonNull, actorId: Number(actorId), ...requestMeta(meta) } });
    }
  });
}
const updateFinanceSettings = (body, actorId, meta) => update('FINANCE', {
  primaryCurrency: enumValue(body.primaryCurrency, CURRENCIES, 'Devise'),
  invoicePrefix: prefix(body.invoicePrefix), receiptPrefix: prefix(body.receiptPrefix),
  nextInvoiceNumber: BigInt(integer(body.nextInvoiceNumber, 1, 999999999, 'Prochain numéro de facture')),
  nextReceiptNumber: BigInt(integer(body.nextReceiptNumber, 1, 999999999, 'Prochain numéro de reçu')),
  trainingFeesEnabled: bool(body.trainingFeesEnabled), syllabusFeesEnabled: bool(body.syllabusFeesEnabled),
  certificateFeesEnabled: bool(body.certificateFeesEnabled), showBalanceOnReceipts: bool(body.showBalanceOnReceipts),
  showPaymentMethod: bool(body.showPaymentMethod), showPaymentReference: bool(body.showPaymentReference),
}, actorId, meta);
function prefix(value) {
  const result = String(value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(result)) throw new SettingsError('INVALID_PREFIX', 'Préfixe invalide.');
  return result;
}
const updateCertificateSettings = (body, actorId, meta) => update('CERTIFICATES', {
  certificatesEnabled: bool(body.certificatesEnabled), certificateSignerName: text(body.certificateSignerName, 160, true),
  certificateSignerTitle: text(body.certificateSignerTitle, 160, true), certificateIntroText: text(body.certificateIntroText, 500, true),
  certificateValidationText: text(body.certificateValidationText, 500, true), certificateIssuePlace: text(body.certificateIssuePlace, 160),
  certificateNumberFormat: certificateFormat(body.certificateNumberFormat),
  certificateShowVerificationCode: bool(body.certificateShowVerificationCode), certificateShowLogo: bool(body.certificateShowLogo),
}, actorId, meta);
function certificateFormat(value) {
  const result = text(value, 80, true);
  if (!result.includes('{NUMBER}') || !/^[A-Za-z0-9{}_/-]+$/.test(result)) throw new SettingsError('INVALID_CERTIFICATE_FORMAT', 'Format de certificat invalide.');
  return result;
}
const updateLmsSettings = (body, actorId, meta) => update('LMS', {
  lmsEnabled: bool(body.lmsEnabled), lmsProgressionMode: enumValue(body.lmsProgressionMode, ['REQUIRED', 'FREE'], 'Progression'),
  lmsMaxTrackedMinutesPerAction: integer(body.lmsMaxTrackedMinutesPerAction, 1, 1440, 'Durée suivie'),
  lmsRequirePreviousLesson: bool(body.lmsRequirePreviousLesson), lmsDownloadsEnabled: bool(body.lmsDownloadsEnabled),
  lmsAutoResumeEnabled: bool(body.lmsAutoResumeEnabled), lmsTimeTrackingEnabled: bool(body.lmsTimeTrackingEnabled),
  studentWelcomeMessage: text(body.studentWelcomeMessage, 1000), teacherWelcomeMessage: text(body.teacherWelcomeMessage, 1000),
}, actorId, meta);
const updateAssessmentSettings = (body, actorId, meta) => {
  const max = Number(body.defaultMaximumScore), pass = Number(body.defaultPassingScore);
  if (!Number.isFinite(max) || max <= 0 || max > 10000 || !Number.isFinite(pass) || pass < 0 || pass > max) throw new SettingsError('INVALID_SCORE', 'Notes par défaut invalides.');
  return update('ASSESSMENTS', {
    writtenAssessmentsEnabled: bool(body.writtenAssessmentsEnabled), recordedOralAssessmentsEnabled: bool(body.recordedOralAssessmentsEnabled),
    liveVideoOralAssessmentsEnabled: bool(body.liveVideoOralAssessmentsEnabled), defaultMaximumScore: new Prisma.Decimal(max),
    defaultPassingScore: new Prisma.Decimal(pass), defaultWrittenDurationMinutes: integer(body.defaultWrittenDurationMinutes, 1, 1440, 'Durée écrite'),
    maxAudioFileSizeMb: integer(body.maxAudioFileSizeMb, 1, 500, 'Taille audio'), allowedVideoPlatforms: list(body.allowedVideoPlatforms, PLATFORMS, 'Plateformes'),
    automaticResultPublication: bool(body.automaticResultPublication), showEvaluatorComment: bool(body.showEvaluatorComment),
  }, actorId, meta);
};
const updateAttendanceSettings = (body, actorId, meta) => update('ATTENDANCE', {
  attendanceLateMinutes: integer(body.attendanceLateMinutes, 0, 1440, 'Délai de retard'),
  attendanceCorrectionEnabled: bool(body.attendanceCorrectionEnabled),
  attendanceCorrectionMaxHours: integer(body.attendanceCorrectionMaxHours, 1, 8760, 'Durée de correction'),
  attendanceCorrectionReasonRequired: bool(body.attendanceCorrectionReasonRequired),
  attendanceTechnicalIssueEnabled: bool(body.attendanceTechnicalIssueEnabled), attendanceExcusedEnabled: bool(body.attendanceExcusedEnabled),
}, actorId, meta);
const updateDocumentSettings = (body, actorId, meta) => update('DOCUMENTS', {
  documentShowLogo: bool(body.documentShowLogo), documentShowCenterName: bool(body.documentShowCenterName),
  documentShowAddress: bool(body.documentShowAddress), documentShowPhone: bool(body.documentShowPhone),
  documentShowEmail: bool(body.documentShowEmail), documentShowCurrency: bool(body.documentShowCurrency),
  documentFooter: text(body.documentFooter, 500), documentThankYouText: text(body.documentThankYouText, 500),
}, actorId, meta);

async function nextNumber(kind, client = prisma) {
  const invoice = kind === 'invoice';
  if (!invoice && kind !== 'receipt') throw new SettingsError('INVALID_NUMBER_KIND', 'Type de numéro invalide.');
  const column = invoice ? 'next_invoice_number' : 'next_receipt_number';
  const prefixColumn = invoice ? 'invoice_prefix' : 'receipt_prefix';
  const rows = await client.$queryRawUnsafe(
    `UPDATE "center_settings" SET "${column}" = "${column}" + 1, "updated_at" = NOW() WHERE "id" = 'MAIN' RETURNING "${prefixColumn}" AS prefix, "${column}" - 1 AS number`,
  );
  if (!rows.length) { await ensureSettings(client); return nextNumber(kind, client); }
  return `${rows[0].prefix}-${rows[0].number.toString().padStart(6, '0')}`;
}
const getNextInvoiceNumber = (client) => nextNumber('invoice', client);
const getNextReceiptNumber = (client) => nextNumber('receipt', client);

async function storePrivateFile(file, category, actorId, meta = {}) {
  enumValue(category, FILE_CATEGORIES, 'Catégorie de fichier');
  if (!file?.buffer || !file.size) throw new SettingsError('FILE_REQUIRED', 'Fichier obligatoire.');
  if (file.size > 5 * 1024 * 1024) throw new SettingsError('FILE_TOO_LARGE', 'Le fichier dépasse 5 Mo.');
  const detected = await (await import('file-type')).fileTypeFromBuffer(file.buffer);
  const extension = detected && ALLOWED_IMAGES[detected.mime];
  if (!extension || !ALLOWED_IMAGES[file.mimetype]) throw new SettingsError('INVALID_FILE', 'Format d’image non autorisé.');
  const originalExtension = path.extname(file.originalname || '').toLowerCase().replace('.', '');
  if (!['png', 'jpg', 'jpeg', 'webp'].includes(originalExtension)) throw new SettingsError('INVALID_EXTENSION', 'Extension non autorisée.');
  const storageKey = `${crypto.randomUUID()}.${extension}`;
  await fs.mkdir(PRIVATE_ROOT, { recursive: true });
  await fs.writeFile(path.join(PRIVATE_ROOT, storageKey), file.buffer, { flag: 'wx' });
  try {
    return await prisma.$transaction(async (tx) => {
      const settings = await ensureSettings(tx);
      const field = FILE_FIELDS[category];
      const oldId = field ? settings[field] : null;
      const saved = await tx.privateSettingFile.create({ data: { category, storageKey, mimeType: detected.mime, extension, sizeBytes: file.size, uploadedById: Number(actorId) } });
      if (field) {
        await tx.centerSettings.update({ where: { id: MAIN_ID }, data: { [field]: saved.id, updatedById: Number(actorId) } });
        if (oldId) await tx.privateSettingFile.update({ where: { id: oldId }, data: { deletedAt: new Date(), replacedById: saved.id } });
      }
      await tx.centerSettingsAudit.create({ data: { category: 'FILES', field: category, oldValue: oldId || Prisma.JsonNull, newValue: saved.id, actorId: Number(actorId), ...requestMeta(meta) } });
      return saved;
    });
  } catch (error) { await fs.unlink(path.join(PRIVATE_ROOT, storageKey)).catch(() => {}); throw error; }
}
async function getPrivateFile(fileId) {
  const id = integer(fileId, 1, 2147483647, 'Fichier');
  const file = await prisma.privateSettingFile.findFirst({ where: { id, deletedAt: null } });
  if (!file) throw new SettingsError('FILE_NOT_FOUND', 'Fichier introuvable.', 404);
  const absolutePath = path.resolve(PRIVATE_ROOT, file.storageKey);
  if (!absolutePath.startsWith(`${PRIVATE_ROOT}${path.sep}`)) throw new SettingsError('FILE_NOT_FOUND', 'Fichier introuvable.', 404);
  return { file, absolutePath };
}
async function getHistory({ category, page = 1, pageSize = 50 } = {}) {
  const take = Math.min(Math.max(Number(pageSize) || 50, 1), 100), skip = (Math.max(Number(page) || 1, 1) - 1) * take;
  const where = category ? { category: String(category).slice(0, 50) } : {};
  return prisma.centerSettingsAudit.findMany({ where, include: { actor: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, skip, take });
}
async function getAdminView() {
  const [settings, levels, history, files] = await Promise.all([getCenterSettings(), ensureLevels().then(() => prisma.centerLevelSettings.findMany({ orderBy: { displayOrder: 'asc' } })), getHistory({ pageSize: 25 }), prisma.privateSettingFile.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } })]);
  return { settings, levels, history, files };
}

module.exports = {
  SettingsError, MAIN_ID, DEFAULTS, CURRENCIES, LEVELS, MODES, DAYS, PLATFORMS, FILE_CATEGORIES,
  ensureSettings, getCenterSettings, getPublicCenterSettings, getAdminView, getHistory,
  updateGeneralSettings, updateBrandingSettings, updateAcademicSettings, updateLevelSettings,
  updateFinanceSettings, updateCertificateSettings, updateLmsSettings, updateAssessmentSettings,
  updateAttendanceSettings, updateDocumentSettings, getNextInvoiceNumber, getNextReceiptNumber,
  storePrivateFile, getPrivateFile, getPublicLogo,
};
