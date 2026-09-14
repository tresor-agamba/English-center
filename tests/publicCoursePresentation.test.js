const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicCourseCard, buildPublicCoursePresentation } = require('../src/utils/publicCoursePresentation.util');

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

test('LEVEL_BASED : parcours complet et tarif par niveau, sans modifier le prix source', () => {
  const source = course({ structureType: 'LEVEL_BASED', numberOfLevels: 3, price: '60.00', durationValue: 24, durationUnit: 'HOURS', sessionCount: 16 });
  const { presentation, facts } = buildPublicCourseCard(source);
  assert.equal(presentation.totals.totalSessions, 48);
  assert.equal(presentation.totals.totalDuration, 72);
  assert.equal(presentation.indicativePrice.amount, 180);
  assert.equal(presentation.price.amount, 60);
  assert.equal(presentation.price.perLevel, true);
  assert.equal(facts.find(f => f.labelKey === 'course.fact.duration').durationValue, 72);
  assert.equal(facts.find(f => f.labelKey === 'structure.sessions').value, '48');
  assert.equal(presentation.perLevelFacts[0].durationValue, 24);
  assert.equal(presentation.perLevelFacts[1].value, '16');
  assert.ok(presentation.perLevelFacts.every(f => f.perLevel));
  assert.equal(source.price, '60.00');
});

test('SIMPLE et historique : valeurs inchangées, aucun suffixe par niveau', () => {
  const simple = buildPublicCoursePresentation(course({ structureType: 'SIMPLE', price: 40, durationValue: 12, durationUnit: 'HOURS', sessionCount: 8 }));
  assert.equal(simple.price.value, '40 USD');
  assert.equal(simple.price.perLevel, false);
  assert.equal(simple.duration.value, '12 heures');
  assert.equal(simple.totals.totalSessions, 8);
  assert.deepEqual(simple.perLevelFacts, []);
  assert.equal(simple.indicativePrice, null);
  const legacy = buildPublicCoursePresentation(course({ durationValue: null, durationUnit: null, duration: '12 heures' }));
  assert.equal(legacy.duration.value, '12 heures');
  assert.equal(legacy.totals.levelBased, false);
  assert.equal(legacy.programmeFacts.length, 1);
});

test('tarif indisponible : aucun prix fictif ou total indicatif exposé', () => {
  for (const overrides of [{ price: null }, { pricingActive: false }]) {
    const presentation = buildPublicCoursePresentation(course({ structureType: 'LEVEL_BASED', numberOfLevels: 3, sessionCount: 16, ...overrides }));
    assert.equal(presentation.price, null);
    assert.equal(presentation.indicativePrice, null);
  }
});

test('les tarifs fractionnaires conservent leurs deux décimales en français', () => {
  const presentation = buildPublicCoursePresentation(course({ price: '150.50' }));
  assert.equal(presentation.price.value, '150,50 USD');
  assert.equal(presentation.price.amount, 150.5);
});
