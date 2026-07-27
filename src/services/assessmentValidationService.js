const { Prisma } = require('@prisma/client');

const ASSESSMENT_MODES = ['WRITTEN', 'RECORDED_ORAL', 'LIVE_VIDEO_ORAL'];
const ASSESSMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'];
const MEETING_PLATFORMS = ['GOOGLE_MEET', 'ZOOM', 'MICROSOFT_TEAMS', 'JITSI', 'OTHER'];
const QUESTION_TYPES_BY_MODE = Object.freeze({
  WRITTEN: [
    'MULTIPLE_CHOICE', 'MULTIPLE_SELECT', 'TRUE_FALSE', 'SHORT_TEXT', 'LONG_TEXT',
    'FILL_IN_THE_BLANK', 'MATCHING', 'ORDERING', 'LISTENING', 'READING',
    'READING_COMPREHENSION', 'LISTENING_COMPREHENSION', 'ESSAY',
  ],
  RECORDED_ORAL: [
    'ORAL_QUIZ', 'RECORDED_PRESENTATION', 'READ_ALOUD', 'IMAGE_DESCRIPTION',
    'LISTEN_AND_RESPOND', 'PRONUNCIATION', 'PROFESSIONAL_SIMULATION',
    'SHORT_ORAL_RESPONSE', 'LONG_ORAL_RESPONSE',
  ],
  LIVE_VIDEO_ORAL: [],
});
const ASSESSMENT_TRANSITIONS = Object.freeze({
  DRAFT: ['PUBLISHED'],
  PUBLISHED: ['CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
});
const LIVE_ORAL_TRANSITIONS = Object.freeze({
  SCHEDULED: ['READY', 'IN_PROGRESS', 'ABSENT', 'CANCELLED', 'RESCHEDULED'],
  READY: ['IN_PROGRESS', 'ABSENT', 'CANCELLED', 'RESCHEDULED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: ['GRADED'],
  ABSENT: ['RESCHEDULED'],
  CANCELLED: [],
  RESCHEDULED: [],
  GRADED: [],
});

class AssessmentValidationError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'AssessmentValidationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function parseId(value, label = 'élément') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AssessmentValidationError('INVALID_ID', `Identifiant de ${label} invalide.`);
  }
  return id;
}

function requiredText(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new AssessmentValidationError('REQUIRED_FIELD', `${label} est obligatoire.`);
  if (text.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new AssessmentValidationError('INVALID_TEXT', `${label} est invalide.`);
  }
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return requiredText(value, label, maxLength);
}

function parseInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AssessmentValidationError('INVALID_INTEGER', `${label} est invalide.`);
  }
  return parsed;
}

function parseDecimal(value, label, { min = '0', max = '999999.99' } = {}) {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw)) {
    throw new AssessmentValidationError('INVALID_DECIMAL', `${label} est invalide.`);
  }
  const decimal = new Prisma.Decimal(raw);
  if (decimal.lt(new Prisma.Decimal(min)) || decimal.gt(new Prisma.Decimal(max))) {
    throw new AssessmentValidationError('INVALID_DECIMAL', `${label} est invalide.`);
  }
  return decimal;
}

function parseOptionalDate(value, label) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AssessmentValidationError('INVALID_DATE', `${label} est invalide.`);
  return date;
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toUpperCase();
  if (!ASSESSMENT_MODES.includes(mode)) throw new AssessmentValidationError('INVALID_MODE', 'Mode d’évaluation invalide.');
  return mode;
}

function validateQuestionType(modeValue, typeValue) {
  const mode = normalizeMode(modeValue);
  const type = String(typeValue || '').trim().toUpperCase();
  if (!QUESTION_TYPES_BY_MODE[mode].includes(type)) {
    throw new AssessmentValidationError('QUESTION_MODE_MISMATCH', 'Ce type de question ne correspond pas au mode de l’évaluation.');
  }
  return type;
}

function normalizeMeetingPlatform(value) {
  const raw = String(value || '').trim().toUpperCase().replaceAll(' ', '_');
  if (raw.includes('GOOGLE')) return 'GOOGLE_MEET';
  if (raw.includes('ZOOM')) return 'ZOOM';
  if (raw.includes('TEAMS') || raw.includes('MICROSOFT')) return 'MICROSOFT_TEAMS';
  if (raw.includes('JITSI')) return 'JITSI';
  if (!MEETING_PLATFORMS.includes(raw)) throw new AssessmentValidationError('INVALID_PLATFORM', 'Plateforme de réunion invalide.');
  return raw;
}

function validatePrivateMeetingUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch {
    throw new AssessmentValidationError('INVALID_MEETING_URL', 'Le lien de réunion est invalide.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.toString().length > 2000) {
    throw new AssessmentValidationError('INVALID_MEETING_URL', 'Le lien de réunion doit être une URL HTTPS sécurisée.');
  }
  return url.toString();
}

function validateDateRange(start, end, labels = ['La date de début', 'La date de fin']) {
  if (start && end && end <= start) {
    throw new AssessmentValidationError('INVALID_DATE_RANGE', `${labels[1]} doit être postérieure à ${labels[0].toLowerCase()}.`);
  }
  return { start, end };
}

function assertTransition(map, from, to, operation = 'transition') {
  if (!map[from]?.includes(to)) {
    throw new AssessmentValidationError('INVALID_STATUS_TRANSITION', `Cette ${operation} de statut n’est pas autorisée.`);
  }
  return to;
}

function validateAssessmentTransition(from, to) {
  return assertTransition(ASSESSMENT_TRANSITIONS, from, to, 'transition d’évaluation');
}

function validateLiveOralTransition(from, to) {
  return assertTransition(LIVE_ORAL_TRANSITIONS, from, to, 'transition de session orale');
}

function validateCriteria(criteria, totalPointsValue) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new AssessmentValidationError('CRITERIA_REQUIRED', 'La grille d’évaluation doit contenir au moins un critère.');
  }
  const totalPoints = new Prisma.Decimal(totalPointsValue);
  let weightSum = new Prisma.Decimal(0);
  let scoreSum = new Prisma.Decimal(0);
  const codes = new Set();
  const positions = new Set();
  const normalized = criteria.map((criterion, index) => {
    const code = requiredText(criterion.code, `Le code du critère ${index + 1}`, 60).toUpperCase().replace(/\s+/g, '_');
    if (!/^[A-Z][A-Z0-9_]*$/.test(code) || codes.has(code)) {
      throw new AssessmentValidationError('INVALID_CRITERION_CODE', 'Les codes de critères doivent être uniques et valides.');
    }
    const position = parseInteger(criterion.position, 'La position du critère', { min: 1, max: 1000 });
    if (positions.has(position)) throw new AssessmentValidationError('DUPLICATE_CRITERION_POSITION', 'Les positions des critères doivent être uniques.');
    codes.add(code);
    positions.add(position);
    const weight = parseDecimal(criterion.weight, 'Le poids du critère', { min: '0.01', max: '100' });
    const maxScore = parseDecimal(criterion.maxScore, 'La note maximale du critère', { min: '0.01' });
    weightSum = weightSum.plus(weight);
    scoreSum = scoreSum.plus(maxScore);
    return {
      code,
      label: requiredText(criterion.label, 'Le libellé du critère', 180),
      description: optionalText(criterion.description, 'La description du critère', 2000),
      weight,
      maxScore,
      position,
    };
  });
  if (!weightSum.equals(new Prisma.Decimal(100))) {
    throw new AssessmentValidationError('INVALID_CRITERIA_WEIGHT', 'La somme des poids des critères doit être égale à 100.');
  }
  if (!scoreSum.equals(totalPoints)) {
    throw new AssessmentValidationError('INVALID_CRITERIA_SCORE', 'La somme des notes maximales des critères doit correspondre au total de l’évaluation.');
  }
  return normalized;
}

module.exports = {
  ASSESSMENT_MODES,
  ASSESSMENT_STATUSES,
  MEETING_PLATFORMS,
  QUESTION_TYPES_BY_MODE,
  ASSESSMENT_TRANSITIONS,
  LIVE_ORAL_TRANSITIONS,
  AssessmentValidationError,
  parseId,
  requiredText,
  optionalText,
  parseInteger,
  parseDecimal,
  parseOptionalDate,
  normalizeMode,
  validateQuestionType,
  normalizeMeetingPlatform,
  validatePrivateMeetingUrl,
  validateDateRange,
  validateAssessmentTransition,
  validateLiveOralTransition,
  validateCriteria,
};
