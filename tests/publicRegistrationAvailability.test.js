const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');
const registrationService = require('../src/services/registrationService');
const registrationController = require('../src/controllers/registrationController');
const courseService = require('../src/services/courseService');
const { isPublicCourse } = require('../src/services/coursePublicationPolicy');
const { sessionRegistrationState } = require('../src/services/enrollmentPolicy');
const { formatCourseType, formatDuration } = require('../src/utils/catalogFormat.util');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const at = (days) => new Date(now.getTime() + days * DAY);

function session(overrides = {}) {
  return {
    status: 'OPEN', startDate: at(2), registrationDeadline: at(1), capacity: 10,
    _count: { enrollments: 0 }, ...overrides,
  };
}

function course(overrides = {}) {
  return {
    id: 1, title: 'English Level 1', slug: 'english-level-1', shortDescription: 'Public course',
    level: 'Level 1', durationValue: 8, durationUnit: 'WEEKS', price: 100, currency: 'USD',
    pricingMode: 'ONE_TIME', pricingActive: true, isPublished: true, lmsStatus: 'PUBLISHED',
    archivedAt: null, closedAt: null, createdAt: now, trainingSessions: [session()], ...overrides,
  };
}

test('la politique publique couvre publication, sessions, dates et capacité', () => {
  assert.equal(isPublicCourse(course({ isPublished: false })), false, 'brouillon exclu');
  assert.equal(isPublicCourse(course({ archivedAt: now })), false, 'formation archivée exclue');
  assert.equal(isPublicCourse(course({ closedAt: now })), false, 'formation fermée exclue');
  assert.equal(isPublicCourse(course({ lmsStatus: 'DRAFT' })), false, 'statut LMS non publié exclu');
  assert.equal(sessionRegistrationState(session(), now), 'OPEN');
  assert.equal(sessionRegistrationState(session({ status: 'CANCELLED' }), now), 'UNAVAILABLE');
  assert.equal(sessionRegistrationState(session({ startDate: at(-1) }), now), 'UNAVAILABLE');
  assert.equal(sessionRegistrationState(session({ registrationDeadline: at(-1) }), now), 'CLOSED');
  assert.equal(sessionRegistrationState(session({ capacity: 1, _count: { enrollments: 1 } }), now), 'FULL');
});

test('la liste /register exclut absence de session et session pleine', async () => {
  const rows = [
    course({ id: 1, title: 'Visible' }),
    course({ id: 2, title: 'Sans session', trainingSessions: [] }),
    course({ id: 3, title: 'Complet', trainingSessions: [session({ capacity: 1, _count: { enrollments: 1 } })] }),
  ];
  const client = { course: { findMany: async () => rows } };
  assert.deepEqual(await registrationService.listCoursesForPublicRegistration(client), [
    { id: 1, title: 'Visible', slug: 'english-level-1' },
  ]);
});

test('le paramètre course est présélectionné ou expliqué sans être perdu silencieusement', async () => {
  const original = registrationService.listCoursesForPublicRegistration;
  registrationService.listCoursesForPublicRegistration = async () => [{ id: 7, title: 'Level 2', slug: 'level-2' }];
  try {
    const response = { statusCode: 0, status(code) { this.statusCode = code; return this; }, render(view, data) { this.view = view; this.data = data; return this; } };
    await registrationController.newForm({ query: { course: '7' } }, response);
    assert.equal(response.data.form.courseId, '7');
    assert.equal(response.data.error, null);
    await registrationController.newForm({ query: { course: '99' } }, response);
    assert.match(response.data.error, /pas ouverte aux inscriptions/i);
  } finally {
    registrationService.listCoursesForPublicRegistration = original;
  }
});

test('le catalogue ne propose aucun CTA trompeur sans session ouverte', async () => {
  const html = await ejs.renderFile(path.resolve('views/public/courses/index.ejs'), {
    title: 'Courses', courses: [{ ...course(), courseType: 'GENERAL_ENGLISH', upcomingSessionCount: 0, nextSessionStart: null }],
    formatCourseType, formatDuration,
  });
  assert.match(html, /No open session/);
  assert.doesNotMatch(html, /href="\/register\?course=1"/);
});

test('l’administration distingue les états d’inscription publique', () => {
  assert.equal(courseService.decoratePublication(course({ trainingSessions: [] })).publicRegistrationState, 'NO_OPEN_SESSION');
  assert.equal(courseService.decoratePublication(course()).publicRegistrationState, 'OPEN');
  assert.equal(courseService.decoratePublication(course({ trainingSessions: [session({ capacity: 0 })] })).publicRegistrationState, 'FULL');
  assert.equal(courseService.decoratePublication(course({ trainingSessions: [session({ registrationDeadline: at(-1) })] })).publicRegistrationState, 'CLOSED');
  assert.equal(courseService.decoratePublication(course({ archivedAt: now })).publicRegistrationState, 'ARCHIVED');
});
