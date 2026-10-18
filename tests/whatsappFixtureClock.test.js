const test = require('node:test');
const assert = require('node:assert/strict');
const { createWhatsAppFixtureClock } = require('./helpers/whatsappFixtureClock');

test('fixture time accepts a persisted timestamp ahead by 1 to 3 milliseconds', () => {
  for (const offset of [1, 2, 3]) {
    const clock = createWhatsAppFixtureClock(new Date(1000));
    const row = { updatedAt: new Date(1000 + offset), providerTimestamp: new Date(1000) };
    clock.observeFixture(row);
    assert.equal(clock.now().getTime(), row.updatedAt.getTime());
    assert.ok(row.updatedAt <= clock.now());
    assert.deepEqual(row, { updatedAt: new Date(1000 + offset), providerTimestamp: new Date(1000) });
  }
});

test('workers share one frozen instant and returned Date objects cannot change it', async () => {
  const clock = createWhatsAppFixtureClock(new Date(1000));
  clock.observeFixture({ updatedAt: new Date(1003) });
  const copy = clock.now();
  copy.setTime(999999);
  const observations = await Promise.all([Promise.resolve().then(clock.now), Promise.resolve().then(clock.now)]);
  assert.deepEqual(observations.map(date => date.getTime()), [1003, 1003]);
});

test('backoff remains ineligible until test time reaches the exact persisted deadline', () => {
  const clock = createWhatsAppFixtureClock(new Date(1000));
  const persisted = { updatedAt: new Date(61000) };
  assert.equal(persisted.updatedAt <= clock.now(), false);
  clock.advanceTo(new Date(60999));
  assert.equal(persisted.updatedAt <= clock.now(), false);
  clock.advanceTo(persisted.updatedAt);
  assert.equal(persisted.updatedAt <= clock.now(), true);
  const nextDeadline = new Date(clock.now().getTime() + 300000);
  assert.equal(nextDeadline <= clock.now(), false);
});

test('fixture time stays monotonic and rejects invalid dates', () => {
  const clock = createWhatsAppFixtureClock(new Date(2000));
  clock.observeFixture({ updatedAt: new Date(1000), receivedAt: new Date(1500) });
  assert.equal(clock.now().getTime(), 2000);
  assert.throws(() => clock.advanceTo(new Date(1999)), RangeError);
  assert.throws(() => clock.observeFixture({ updatedAt: new Date(NaN) }), TypeError);
  assert.throws(() => createWhatsAppFixtureClock('2000'), TypeError);
});
