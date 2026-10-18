const test = require('node:test');
const assert = require('node:assert/strict');
const { readExplicitTestUrl, ISOLATION_CONFIRMATION } = require('../src/utils/whatsappIntegrationTarget');
function settings() {
  return { NVA_WHATSAPP_TEST_DATABASE_URL: 'postgresql://nva_whatsapp_test_runner:synthetic-secret@127.0.0.1:55432/nva_whatsapp_test?schema=public',
    NVA_WHATSAPP_TEST_EXPECTED_URL_HOST: '127.0.0.1', NVA_WHATSAPP_TEST_EXPECTED_URL_PORT: '55432',
    NVA_WHATSAPP_TEST_EXPECTED_SERVER_ADDRESS: '127.0.0.1', NVA_WHATSAPP_TEST_EXPECTED_SERVER_PORT: '55432',
    NVA_WHATSAPP_TEST_ISOLATION_CONFIRMED: ISOLATION_CONFIRMATION };
}
test('reviewed explicit identity is accepted by pure validator without connecting', () => {
  assert.equal(readExplicitTestUrl(settings()).pathname, '/nva_whatsapp_test');
});
test('database name alone never authorizes integration tests', () => {
  const env = settings(); delete env.NVA_WHATSAPP_TEST_ISOLATION_CONFIRMED;
  assert.throws(() => readExplicitTestUrl(env), /Independent review/);
});
test('each missing explicit setting is refused without leaking the connection secret', () => {
  for (const key of Object.keys(settings())) {
    const env = settings(); delete env[key];
    assert.throws(() => readExplicitTestUrl(env), error => !error.message.includes('synthetic-secret'));
  }
});
test('production, mismatched identities and routing overrides are refused', () => {
  for (const override of [
    { NODE_ENV: 'production' }, { NVA_WHATSAPP_TEST_EXPECTED_URL_HOST: 'other-host' },
    { NVA_WHATSAPP_TEST_EXPECTED_URL_PORT: '5432' }, { NVA_WHATSAPP_TEST_EXPECTED_SERVER_PORT: 'invalid' },
    { NVA_WHATSAPP_TEST_DATABASE_URL: settings().NVA_WHATSAPP_TEST_DATABASE_URL.replace('nva_whatsapp_test?', 'nva_production?') },
    { NVA_WHATSAPP_TEST_DATABASE_URL: settings().NVA_WHATSAPP_TEST_DATABASE_URL.replace('schema=public', 'schema=private') },
    { NVA_WHATSAPP_TEST_DATABASE_URL: settings().NVA_WHATSAPP_TEST_DATABASE_URL + '&host=other-host' },
    { NVA_WHATSAPP_TEST_DATABASE_URL: settings().NVA_WHATSAPP_TEST_DATABASE_URL + '&schema=public' },
  ]) assert.throws(() => readExplicitTestUrl({ ...settings(), ...override }));
});
test('development target cannot be reused under different credentials', () => {
  const env = settings(); env.DATABASE_URL = env.NVA_WHATSAPP_TEST_DATABASE_URL.replace('nva_whatsapp_test_runner:synthetic-secret', 'different-role:different-secret');
  assert.throws(() => readExplicitTestUrl(env), /ambiguous/);
});
