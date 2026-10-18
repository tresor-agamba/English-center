// Pure validation: no dotenv, connections, writes or secret-bearing diagnostics.
const ISOLATION_CONFIRMATION = 'dedicated-postgresql-instance-reviewed';
function required(env, key) {
  if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`Required test setting is missing: ${key}`);
  return env[key].trim();
}
function readExplicitTestUrl(env = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('WhatsApp integration tests are forbidden in production mode.');
  if (env.NVA_WHATSAPP_TEST_ISOLATION_CONFIRMED !== ISOLATION_CONFIRMATION) throw new Error('Independent review of a dedicated PostgreSQL test instance is required.');
  let url;
  try { url = new URL(required(env, 'NVA_WHATSAPP_TEST_DATABASE_URL')); }
  catch { throw new Error('Explicit WhatsApp test connection is missing or invalid.'); }
  try {
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) throw new Error();
    const host = required(env, 'NVA_WHATSAPP_TEST_EXPECTED_URL_HOST').toLowerCase();
    const port = Number(required(env, 'NVA_WHATSAPP_TEST_EXPECTED_URL_PORT'));
    const serverPort = Number(required(env, 'NVA_WHATSAPP_TEST_EXPECTED_SERVER_PORT'));
    required(env, 'NVA_WHATSAPP_TEST_EXPECTED_SERVER_ADDRESS');
    if (![port, serverPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error();
    if (decodeURIComponent(url.pathname.slice(1)) !== 'nva_whatsapp_test'
      || decodeURIComponent(url.username) !== 'nva_whatsapp_test_runner'
      || url.hostname.toLowerCase() !== host || Number(url.port || 5432) !== port) throw new Error();
    const allowed = new Set(['schema', 'sslmode', 'connection_limit', 'connect_timeout', 'pool_timeout', 'socket_timeout']);
    for (const [key, value] of url.searchParams) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error();
      if (key === 'schema' && value !== 'public') throw new Error();
      if (key === 'sslmode' && !['require', 'verify-full', 'disable', 'prefer'].includes(value)) throw new Error();
      if (!['schema', 'sslmode'].includes(key) && !/^[1-9]\d*$/.test(value)) throw new Error();
    }
    for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) {
      if (!env[key]) continue;
      const other = new URL(env[key]);
      if (other.hostname.toLowerCase() === url.hostname.toLowerCase()
        && Number(other.port || 5432) === Number(url.port || 5432)
        && decodeURIComponent(other.pathname) === decodeURIComponent(url.pathname)) throw new Error();
    }
  } catch { throw new Error('WhatsApp integration target is ambiguous or does not match the reviewed dedicated instance.'); }
  return url;
}
module.exports = { ISOLATION_CONFIRMATION, readExplicitTestUrl };
