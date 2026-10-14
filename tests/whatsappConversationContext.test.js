const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationEngine, makeInitialState } = require('../src/services/whatsappConversationEngine');

function fixtures() {
  return [
    { id: 11, slug: 'anglais-general', title: 'Anglais général', pricingActive: true, pricingMode: 'ONE_TIME',
      price: 137, currency: 'USD', upcomingSessionCount: 1, accessPolicy: 'LEGACY_STAGED', structureType: 'SIMPLE',
      privateNotes: 'PRIVATE_CANARY', studentPhone: 'PRIVATE_PHONE',
      session: { id: 101, weekDays: ['Lundi'], startTime: '18:00', endTime: '19:30', registrationGroups: [], timezone: 'Africa/Kinshasa' } },
    { id: 12, slug: 'anglais-affaires', title: 'Anglais des affaires', pricingActive: true, pricingMode: 'ONE_TIME',
      price: 283, currency: 'USD', upcomingSessionCount: 1, accessPolicy: 'FULL_PAYMENT', structureType: 'SIMPLE',
      session: { id: 102, weekDays: ['Samedi'], startTime: '09:00', endTime: '10:30', registrationGroups: [], timezone: 'Africa/Kinshasa' } },
  ];
}
function harness({ courses = fixtures(), openCourses, fail = false } = {}) {
  let published = courses;
  let open = openCourses === undefined ? courses : openCourses;
  let state; let sequence = 0; let catalogReads = 0; let registrationReads = 0;
  const dependencies = {
    catalog: { listPublished: async () => { catalogReads += 1; if (fail) throw new Error('unavailable'); return published; } },
    registration: { listCoursesForPublicRegistration: async () => { registrationReads += 1; return open; } },
    whatsappConfig: () => ({}),
  };
  let engine = createConversationEngine(dependencies);
  return {
    async say(text, extra = {}) {
      const result = await engine.handleMessage({ text, messageId: `context-${++sequence}`, state,
        publicAppUrl: 'https://nva.example', ...extra });
      state = JSON.parse(JSON.stringify(result.state));
      return result;
    },
    state: () => state,
    replace: (courses, openCourses = courses) => { published = courses; open = openCourses; },
    restart: () => { engine = createConversationEngine(dependencies); },
    reads: () => ({ catalogReads, registrationReads }),
  };
}
test('complete objective → course → price → schedule → registration conversation uses current business data', async () => {
  const h = harness();
  const objective = await h.say('Je veux apprendre l’anglais');
  assert.match(objective.text, /Anglais général/); assert.match(objective.text, /Anglais des affaires/);
  assert.equal(objective.state.qualification.objective, 'Je veux apprendre l’anglais');
  assert.equal(objective.state.pendingQuestion.type, 'COURSE');
  const selected = await h.say('Anglais général');
  assert.equal(selected.intent, 'COURSE_SELECTION'); assert.equal(selected.state.selectedCourseId, 11);
  assert.equal(selected.state.selectedCourseSlug, 'anglais-general'); assert.equal(selected.state.step, 'SELECT_TOPIC');
  assert.match(selected.text, /tarif.*horaires.*inscription/);
  const price = await h.say('Le prix'); assert.match(price.text, /137\s?USD/); assert.doesNotMatch(price.text, /60\s?USD/);
  assert.equal(price.state.lastIntent, 'PRICE'); assert.equal(price.state.pendingQuestion, null);
  const schedule = await h.say('Et les horaires ?'); assert.match(schedule.text, /18:00–19:30/);
  assert.equal(schedule.state.lastIntent, 'SCHEDULE'); assert.equal(schedule.state.selectedCourseId, 11);
  const registration = await h.say('Je veux m’inscrire'); assert.match(registration.text, /register\?session=101/);
  assert.deepEqual(registration.actions, []); assert.equal(registration.state.step, 'REGISTRATION');
  assert.equal(registration.state.qualification.objective, objective.state.qualification.objective);
});
test('short course answer fulfills the pending price clarification', async () => {
  const h = harness(); const question = await h.say('Combien coûte la formation ?');
  assert.equal(question.state.pendingQuestion.intent, 'PRICE');
  assert.match((await h.say('Anglais général')).text, /137\s?USD/);
});
test('contextual variants use the selected course without repeating its name', async () => {
  const h = harness(); await h.say('Anglais général');
  assert.match((await h.say('Et le tarif actuel de celle-ci ?')).text, /137\s?USD/);
  assert.match((await h.say('Les modalités d’inscription')).text, /session=101/);
});
test('a unique partial title can resolve a clarification', async () => {
  const h = harness(); await h.say('prix');
  assert.match((await h.say('général')).text, /137\s?USD/);
});
test('an exact course title is not confused with a longer title sharing its prefix', async () => {
  const courses = fixtures(); courses.push({ ...courses[0], id: 13, slug: 'general-avance', title: 'Anglais général avancé' });
  const h = harness({ courses });
  assert.equal((await h.say('Anglais général')).state.selectedCourseId, 11);
});
test('all published courses disappearing clears an obsolete clarification', async () => {
  const h = harness(); await h.say('prix'); h.replace([]);
  const result = await h.say('Anglais général'); assert.match(result.text, /Aucune formation publiée/);
  assert.equal(result.state.pendingQuestion, null);
});
for (const [topic, expected] of [['horaires', /18:00–19:30/], ['essai', /5 séances/], ['inscription', /session=101/]]) {
  test(`short course answer fulfills the pending ${topic} clarification`, async () => {
    const h = harness(); await h.say(topic); const answer = await h.say('Anglais général');
    assert.match(answer.text, expected); assert.equal(answer.state.selectedCourseId, 11);
  });
}
test('explicit change of course replaces context for subsequent questions', async () => {
  const h = harness(); await h.say('Anglais général');
  const switched = await h.say('Je préfère Anglais des affaires'); assert.equal(switched.state.selectedCourseId, 12);
  assert.match((await h.say('prix')).text, /283\s?USD/);
  assert.match((await h.say('horaires')).text, /09:00–10:30/);
});
test('changing course while answering a price question fulfills that question', async () => {
  const h = harness(); await h.say('prix');
  assert.match((await h.say('Anglais des affaires')).text, /283\s?USD/);
});
test('ambiguous course name asks for clarification, never chooses the old course', async () => {
  const h = harness(); await h.say('Anglais général');
  const ambiguous = await h.say('Prix anglais');
  assert.match(ambiguous.text, /Plusieurs formations/); assert.doesNotMatch(ambiguous.text, /137\s?USD/);
  assert.equal(ambiguous.state.pendingQuestion.intent, 'PRICE');
  assert.match((await h.say('Anglais des affaires')).text, /283\s?USD/);
});
test('unknown named course does not silently answer for the remembered course', async () => {
  const h = harness(); await h.say('Anglais général');
  const unknown = await h.say('Prix japonais');
  assert.match(unknown.text, /ne trouve pas cette formation/); assert.doesNotMatch(unknown.text, /137\s?USD/);
  const repeated = await h.say('prix'); assert.match(repeated.text, /Pour quel cours/);
  assert.doesNotMatch(repeated.text, /137\s?USD/);
});
test('unknown clarification answer preserves the pending intent until a valid course arrives', async () => {
  const h = harness(); await h.say('prix'); const unknown = await h.say('xyz blorpt');
  assert.equal(unknown.state.pendingQuestion.intent, 'PRICE'); assert.equal(unknown.state.lastIntent, 'PRICE');
  assert.match((await h.say('Anglais général')).text, /137\s?USD/);
});
test('missing open session never switches the remembered course to an available alternative', async () => {
  const courses = fixtures(); const h = harness({ courses, openCourses: [courses[1]] });
  await h.say('Anglais général');
  const schedule = await h.say('horaires'); assert.match(schedule.text, /Aucune session ouverte.*Anglais général/);
  assert.doesNotMatch(schedule.text, /09:00/); assert.equal(schedule.state.selectedCourseId, 11);
  const registration = await h.say('inscription'); assert.doesNotMatch(registration.text, /https?:\/\//);
  assert.equal(registration.state.selectedCourseId, 11);
});
test('unavailable and changed prices are re-read rather than remembered in state', async () => {
  const h = harness(); await h.say('Anglais général'); await h.say('prix');
  const courses = fixtures(); courses[0].price = 197; h.replace(courses);
  assert.match((await h.say('prix')).text, /197\s?USD/);
  courses[0].pricingActive = false; assert.match((await h.say('prix')).text, /pas actuellement disponible/);
  assert.equal('price' in h.state(), false); assert.ok(h.reads().catalogReads >= 4);
});
test('removed course is revalidated and never replaced automatically', async () => {
  const h = harness(); await h.say('Anglais général'); h.replace([fixtures()[1]]);
  const result = await h.say('horaires'); assert.match(result.text, /n’est plus disponible/);
  assert.doesNotMatch(result.text, /09:00/); assert.equal(result.state.selectedCourseId, null);
});
test('menu resets the request and course but preserves objective and commercial consent', async () => {
  const h = harness(); await h.say('Je veux apprendre l’anglais'); await h.say('Anglais général');
  const result = await h.say('menu principal', { state: { ...h.state(), commercialFollowUpsGranted: true } });
  assert.equal(result.state.selectedCourseId, null); assert.equal(result.state.selectedCourseSlug, null);
  assert.equal(result.state.pendingQuestion, null); assert.equal(result.state.step, 'MENU');
  assert.equal(result.state.commercialFollowUpsGranted, true); assert.ok(result.state.qualification.objective);
  assert.match((await h.say('prix')).text, /Pour quel cours/);
});
test('cancel abandons a pending request without revoking consent', async () => {
  const h = harness(); await h.say('prix'); const result = await h.say('annuler');
  assert.match(result.text, /annulée/); assert.equal(result.state.pendingQuestion, null);
  assert.equal(result.state.optedOut, false); assert.deepEqual(result.actions, []);
});
test('explicit change command asks for a new course', async () => {
  const h = harness(); await h.say('Anglais général'); const result = await h.say('changer de formation');
  assert.equal(result.state.selectedCourseId, null); assert.equal(result.state.pendingQuestion.type, 'COURSE');
  assert.equal((await h.say('Anglais des affaires')).state.selectedCourseId, 12);
});
test('catalog command overrides a previous price clarification', async () => {
  const h = harness(); await h.say('prix'); await h.say('formations');
  const result = await h.say('Anglais général'); assert.equal(result.intent, 'COURSE_SELECTION');
  assert.doesNotMatch(result.text, /137\s?USD/);
});
test('JSON serialization and a fresh engine preserve context', async () => {
  const h = harness(); await h.say('prix'); h.restart();
  assert.match((await h.say('Anglais général')).text, /137\s?USD/); h.restart();
  assert.match((await h.say('horaires')).text, /18:00–19:30/);
  assert.equal(h.state().selectedCourseId, 11);
});
test('legacy slug-only memory is upgraded without migration', async () => {
  const h = harness(); const result = await h.say('prix', { state: { selectedCourseSlug: 'anglais-general' } });
  assert.match(result.text, /137\s?USD/); assert.equal(result.state.selectedCourseId, 11);
});
test('incomprehensible message preserves selected context', async () => {
  const h = harness(); await h.say('Anglais général'); const result = await h.say('xyz blorpt');
  assert.match(result.text, /pas bien compris/); assert.equal(result.state.selectedCourseId, 11);
  assert.match((await h.say('prix')).text, /137\s?USD/);
});
test('handoff pauses ordinary responses and preserves selection and objective', async () => {
  const h = harness(); await h.say('Je veux apprendre l’anglais'); await h.say('Anglais général');
  const handoff = await h.say('conseiller'); assert.equal(handoff.actions[0].type, 'HUMAN_HANDOFF');
  assert.equal(handoff.actions[0].context.selectedCourseSlug, 'anglais-general');
  for (const message of ['prix', 'menu', 'Anglais des affaires']) {
    const result = await h.say(message); assert.equal(result.text, null); assert.equal(result.state.selectedCourseId, 11);
  }
  await h.say('reprendre bot'); assert.match((await h.say('prix')).text, /137\s?USD/);
});
test('STOP takes priority over context and menu cannot resume automation', async () => {
  const h = harness(); await h.say('Anglais général'); const stop = await h.say('STOP');
  assert.equal(stop.actions[0].type, 'OPT_OUT'); assert.equal(stop.text, null); assert.equal(stop.state.step, 'OPTED_OUT');
  for (const message of ['prix', 'menu', 'reprendre bot']) assert.equal((await h.say(message)).text, null);
});
test('public answers expose no private fields or objective containing private information', async () => {
  const h = harness(); await h.say('Anglais général', { state: { qualification: { objective: 'PRIVATE_OBJECTIVE' }, selectedCourseId: 11 } });
  for (const text of ['prix', 'horaires', 'inscription']) {
    const result = await h.say(text); assert.doesNotMatch(result.text, /PRIVATE_/);
    assert.deepEqual(result.actions, []);
  }
});
test('registration never exposes URL credentials or creates a business action', async () => {
  const h = harness(); await h.say('Anglais général');
  const result = await h.say('inscription', { publicAppUrl: 'https://private-user:private-password@nva.example' });
  assert.doesNotMatch(result.text, /private-user|private-password|https?:\/\//); assert.deepEqual(result.actions, []);
});
test('temporary business failure keeps contextual state available for a subsequent request', async () => {
  const h = harness({ fail: true });
  const state = makeInitialState({ selectedCourseId: 11, selectedCourseSlug: 'anglais-general', pendingQuestion: { type: 'COURSE', intent: 'PRICE' } });
  const result = await h.say('Anglais général', { state });
  assert.equal(result.retryable, true); assert.equal(result.state.selectedCourseId, 11);
  assert.equal(result.state.pendingQuestion.intent, 'PRICE');
});
