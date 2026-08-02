const COURSE_TYPE_LABELS = {
  GENERAL_ENGLISH: 'Anglais général',
  BUSINESS_ENGLISH: 'Business English',
  ENGLISH_FOR_BANKERS: 'English for Bankers',
  CONVERSATION: 'Conversation anglaise',
  IELTS_PREPARATION: 'Préparation IELTS',
  BEGINNER_ENGLISH: 'Anglais débutant',
  OTHER: null,
};

const DURATION_UNIT_LABELS = {
  HOURS: ['heure', 'heures'],
  DAYS: ['jour', 'jours'],
  WEEKS: ['semaine', 'semaines'],
  MONTHS: ['mois', 'mois'],
};

const WEEK_DAY_LABELS = {
  MONDAY: 'Lundi',
  TUESDAY: 'Mardi',
  WEDNESDAY: 'Mercredi',
  THURSDAY: 'Jeudi',
  FRIDAY: 'Vendredi',
  SATURDAY: 'Samedi',
  SUNDAY: 'Dimanche',
};

function formatCourseType(value) {
  return COURSE_TYPE_LABELS[value] || null;
}

function formatDuration(course) {
  if (course.durationValue && course.durationUnit && DURATION_UNIT_LABELS[course.durationUnit]) {
    const labels = DURATION_UNIT_LABELS[course.durationUnit];
    return `${course.durationValue} ${course.durationValue > 1 ? labels[1] : labels[0]}`;
  }
  return course.duration || null;
}

function formatWeekDays(values = []) {
  const labels = values.map((value) => WEEK_DAY_LABELS[value]).filter(Boolean);
  if (labels.length < 2) return labels[0] || 'À préciser';
  if (labels.length === 2) return `${labels[0]} et ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} et ${labels.at(-1)}`;
}

module.exports = {
  COURSE_TYPE_LABELS,
  DURATION_UNIT_LABELS,
  WEEK_DAY_LABELS,
  formatCourseType,
  formatDuration,
  formatWeekDays,
};
