const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetaInboxWebhookController } = require('../src/controllers/metaInboxWebhookController');
const request = { rawBody: Buffer.from('{}'), get: () => 'synthetic-signature' };
test('prepared ingress is disabled by default and does not touch storage', async () => {
  const receive = createMetaInboxWebhookController({ inboxService: { acceptRaw: () => assert.fail('disabled') } });
  await receive(request, { sendStatus: code => assert.equal(code, 503) });
});
test('acknowledgement waits for committed durable acceptance, without processing', async () => {
  let complete, status, input;
  const date = new Date('2026-10-18T10:00:00Z');
  const receive = createMetaInboxWebhookController({ enabled: true, now: () => date,
    inboxService: { acceptRaw: async value => { input = value; return new Promise(resolve => { complete = resolve; }); } } });
  const pending = receive(request, { sendStatus: code => { status = code; } });
  assert.equal(status, undefined); assert.equal(input.rawBody, request.rawBody);
  assert.equal(input.signature, 'synthetic-signature'); assert.equal(input.receivedAt, date);
  complete({ accepted: true }); await pending; assert.equal(status, 200);
});
test('unaccepted receipts are never acknowledged as durable', async () => {
  for (const receipt of [undefined, {}, { accepted: false }]) {
    const receive = createMetaInboxWebhookController({ enabled: true, inboxService: { acceptRaw: async () => receipt } });
    await receive(request, { sendStatus: code => assert.equal(code, 503) });
  }
});
for (const [code, expected] of [['META_INBOX_INVALID_SIGNATURE', 403], ['META_INBOX_INVALID_PAYLOAD', 400],
  ['META_INBOX_NOT_ACTIVATED', 503], ['META_INBOX_STORAGE_FAILED', 503]]) {
  test(`ingress fails closed: ${code}`, async () => {
    const receive = createMetaInboxWebhookController({ enabled: true, inboxService: {
      acceptRaw: async () => { throw Object.assign(new Error('private storage details'), { code }); } } });
    await receive(request, { sendStatus: status => assert.equal(status, expected) });
  });
}
