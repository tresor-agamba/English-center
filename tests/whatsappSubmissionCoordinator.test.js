const test = require('node:test');
const assert = require('node:assert/strict');
const { engageSubmission, recipientKey } = require('../src/services/whatsappSubmissionCoordinator');
test('recipient lock canonicalization is stable across recipient formats', () => {
  assert.equal(recipientKey('+15555550123'), recipientKey('15555550123'));
  assert.notEqual(recipientKey('+15555550123'), recipientKey('+15555550124'));
  assert.throws(() => recipientKey('invalid'), /WHATSAPP_INVALID_COORDINATION_RECIPIENT/);
});
test('missing transactional capability fails closed outside isolated mocks', async () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(engageSubmission({ database: {} }), /WHATSAPP_TRANSACTION_REQUIRED/);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});
test('ambiguous transaction completion is never retried as a fresh engagement', async () => {
  let calls = 0;
  const database = { $queryRaw: () => {}, $transaction: async () => { calls++; throw new Error('ambiguous-commit'); } };
  await assert.rejects(engageSubmission({ database, kind: 'conversation' }), /ambiguous-commit/);
  assert.equal(calls, 1);
});
