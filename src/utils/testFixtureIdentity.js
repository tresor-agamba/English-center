const DEFINITIONS = Object.freeze([
  { title: 'Formation essai gratuit', prefix: 'essai-gratuit-', source: 'tests/freeTrialAttendance.test.js' },
  { title: 'Formation principale', prefix: 'student-principale-', source: 'tests/studentDashboard.test.js' },
  { title: 'Cours principal', prefix: 'pedago-principal-', source: 'tests/learningContent.test.js' },
  { title: 'Live principal', prefix: 'live-principal-', source: 'tests/liveMeetingLessons.test.js' },
  { title: 'Parcours étudiant existant', prefix: 'parcours-existant-', source: 'tests/existingStudentEnrollment.test.js' },
]);

function embeddedTimestamp(slug, prefix) {
  const match = String(slug || '').match(new RegExp(`^${prefix}(\\d{13,})-\\d+$`));
  return match ? Number(match[1]) : null;
}

function classifyCourse(course) {
  const definition = DEFINITIONS.find((item) => course.title === item.title || String(course.slug || '').startsWith(item.prefix));
  if (!definition) return { classification: 'E', source: null, reason: 'Origine impossible à déterminer.' };
  const timestamp = embeddedTimestamp(course.slug, definition.prefix);
  const creationTime = new Date(course.createdAt).getTime();
  if (course.title === definition.title && timestamp !== null && Math.abs(timestamp - creationTime) <= 15 * 60 * 1000) {
    return { classification: 'A', source: definition.source, reason: 'Titre, préfixe de slug et horodatage correspondent exactement à la fixture.' };
  }
  return { classification: 'B', source: definition.source, reason: 'Nom ou préfixe connu, mais preuve complète insuffisante.' };
}

const isCertainTestFixture = (course) => classifyCourse(course).classification === 'A';

module.exports = { DEFINITIONS, embeddedTimestamp, classifyCourse, isCertainTestFixture };
