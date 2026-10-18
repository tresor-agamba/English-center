// Explicit per-scenario time. Never sleeps, changes global time or queries a database.
function createWhatsAppFixtureClock(initial = new Date()) {
  const timestamp = value => {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Fixture clock requires a valid Date.');
    }
    return value.getTime();
  };
  let current = timestamp(initial);
  return {
    now: () => new Date(current),
    // Only call for freshly created fixtures before their first send, not retries.
    observeFixture(...rows) {
      for (const row of rows) {
        for (const key of ['updatedAt', 'providerTimestamp', 'receivedAt']) {
          if (row?.[key] != null) current = Math.max(current, timestamp(row[key]));
        }
      }
    },
    // Retries advance explicitly to the deadline actually returned by persistence.
    advanceTo(deadline) {
      const next = timestamp(deadline);
      if (next < current) throw new RangeError('Fixture clock must not move backwards.');
      current = next;
    },
  };
}
module.exports = { createWhatsAppFixtureClock };
