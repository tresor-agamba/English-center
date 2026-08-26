const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicCourseCard } = require('../src/utils/publicCoursePresentation.util');

const course = (overrides = {}) => ({
  id: 1, slug: 'anglais-general', title: 'Anglais général', shortDescription: 'Pratique guidée',
  courseType: 'GENERAL_ENGLISH', trainingMode: 'En ligne', durationValue: 8, durationUnit: 'WEEKS',
  pricingActive: true, price: 120, currency: 'USD', upcomingSessionCount: 0,
  nextPlannedSessionStart: null, ...overrides,
});

test('projette les trois statuts publics depuis les vraies sessions', () => {
  const open = buildPublicCourseCard(course({ upcomingSessionCount: 1 }));
  const soon = buildPublicCourseCard(course({ nextPlannedSessionStart: new Date() }));
  const closed = buildPublicCourseCard(course());
  assert.deepEqual([open.status, soon.status, closed.status], ['open', 'soon', 'closed']);
  assert.equal(open.canRegister, true);
  assert.equal(soon.canRegister, false);
  assert.equal(closed.canRegister, false);
});

test('centralise les clés i18n, les faits réels et la recherche', () => {
  const card = buildPublicCourseCard(course());
  assert.equal(card.categoryKey, 'course.type.generalEnglish');
  assert.match(card.searchText, /anglais général/);
  assert.equal(card.facts.find((fact) => fact.labelKey === 'course.fact.duration').durationValue, 8);
  assert.equal(card.facts.find((fact) => fact.labelKey === 'course.fact.price').amount, 120);
});
