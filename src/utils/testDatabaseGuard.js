const TEST_DATABASE_PATTERN = /(?:^|[_-])test(?:$|[_-])/i;

class TestDatabaseGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TestDatabaseGuardError';
    this.code = code;
  }
}

function normalizedDatabaseIdentity(value, variableName) {
  if (!value) throw new TestDatabaseGuardError(`${variableName}_MISSING`, `${variableName} est obligatoire.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TestDatabaseGuardError(`${variableName}_INVALID`, `${variableName} est invalide.`);
  }
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new TestDatabaseGuardError(`${variableName}_INVALID`, `${variableName} doit utiliser PostgreSQL.`);
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName) throw new TestDatabaseGuardError(`${variableName}_INVALID`, `${variableName} doit nommer une base.`);
  const identity = `${url.protocol}//${url.username}@${url.hostname}:${url.port || '5432'}/${databaseName}`.toLowerCase();
  return { url, databaseName, identity };
}

function assertSafeTestDatabase(env = process.env) {
  if (env.NODE_ENV === 'production') {
    throw new TestDatabaseGuardError('TEST_DATABASE_PRODUCTION_REFUSED', 'Les opérations de test sont interdites en production.');
  }
  const development = normalizedDatabaseIdentity(env.DATABASE_URL, 'DATABASE_URL');
  const test = normalizedDatabaseIdentity(env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');
  if (development.identity === test.identity) {
    throw new TestDatabaseGuardError('TEST_DATABASE_MATCHES_DEVELOPMENT', 'TEST_DATABASE_URL ne doit jamais cibler DATABASE_URL.');
  }
  if (!TEST_DATABASE_PATTERN.test(test.databaseName)) {
    throw new TestDatabaseGuardError('TEST_DATABASE_NAME_UNSAFE', 'Le nom de la base de test doit contenir « _test » ou « -test ».');
  }
  return { development, test };
}

module.exports = {
  TEST_DATABASE_PATTERN,
  TestDatabaseGuardError,
  normalizedDatabaseIdentity,
  assertSafeTestDatabase,
};
