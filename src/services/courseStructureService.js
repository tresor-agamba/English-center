const { Prisma } = require('@prisma/client');
const structureSelect = { structureType: true, numberOfLevels: true, sessionCount: true, accessPolicy: true };
const isLevelBased = course => course?.structureType === 'LEVEL_BASED';
function invalid(message) { const error = new Error(message); error.statusCode = 400; return error; }
function positiveInteger(value, label) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > 2147483647) throw invalid(`${label} doit être un entier positif.`);
  return Number(value);
}
function parseStructure(body) {
  const structureType = body.structureType || 'SIMPLE';
  if (!['SIMPLE', 'LEVEL_BASED'].includes(structureType)) throw invalid('Structure de formation invalide.');
  const numberOfLevels = body.numberOfLevels === '' || body.numberOfLevels == null ? null : positiveInteger(body.numberOfLevels, 'Le nombre de niveaux');
  const sessionCount = body.sessionCount === '' || body.sessionCount == null ? null : positiveInteger(body.sessionCount, 'Le nombre de séances');
  if (structureType === 'SIMPLE' && numberOfLevels !== null) throw invalid('Une formation simple ne peut pas avoir de niveaux actifs.');
  if (structureType === 'LEVEL_BASED' && (!numberOfLevels || !sessionCount)) throw invalid('Le nombre de niveaux et les séances par niveau sont obligatoires.');
  const accessPolicy = body.accessPolicy || (body.structureType ? 'FULL_PAYMENT' : 'LEGACY_STAGED');
  if (!['LEGACY_STAGED', 'FULL_PAYMENT'].includes(accessPolicy)) throw invalid('Règle d’accès invalide.');
  if (accessPolicy === 'LEGACY_STAGED' && sessionCount !== null && sessionCount !== 16) throw invalid('La règle historique exige 16 séances. Choisissez le paiement complet pour cette formation.');
  return { structureType, numberOfLevels, sessionCount, accessPolicy };
}
function validateSessionLevel(course, value) {
  if (!course) throw invalid('Formation introuvable.');
  if (!isLevelBased(course)) {
    if (value !== null && value !== undefined && value !== '') throw invalid('Une formation simple ne peut pas avoir de numéro de niveau.');
    return null;
  }
  const level = positiveInteger(value, 'Le niveau de la session');
  if (level > course.numberOfLevels) throw invalid('Le niveau dépasse le nombre de niveaux de la formation.');
  return level;
}
function courseTotals(course) {
  const levelBased = isLevelBased(course), count = levelBased ? course.numberOfLevels : 1;
  const product = value => {
    if (value == null) return null;
    const result = BigInt(value) * BigInt(count);
    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result.toString();
  };
  return {
    structureType: course.structureType || 'SIMPLE', levelBased,
    ...(levelBased ? { numberOfLevels: count, pricePerLevel: course.price, durationPerLevel: course.durationValue, sessionsPerLevel: course.sessionCount } : {}),
    totalDuration: product(course.durationValue),
    totalSessions: product(course.sessionCount),
    totalIndicativePrice: course.price == null ? null : new Prisma.Decimal(course.price).mul(count).toFixed(2),
  };
}
function accessLimits(course) {
  const legacy = !course?.accessPolicy || course.accessPolicy === 'LEGACY_STAGED';
  return { legacy, trial: legacy ? 5 : 0, partial: legacy ? 10 : 0, total: legacy ? 16 : (course.sessionCount || 2147483647) };
}
module.exports = { structureSelect, isLevelBased, invalid, parseStructure, validateSessionLevel, courseTotals, accessLimits };
