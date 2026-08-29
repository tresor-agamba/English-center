const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePostgresMajor, assertToolCompatibility } = require('../src/utils/postgresTools');

test('compatibilité dynamique des outils PostgreSQL', async (t) => {
  await t.test('lit les versions serveur et CLI', () => {
    assert.equal(parsePostgresMajor('18.6 (Ubuntu 18.6-1)'), 18);
    assert.equal(parsePostgresMajor('pg_dump (PostgreSQL) 18.6'), 18);
  });
  await t.test('accepte serveur 18 et outils 18', () => {
    assert.deepEqual(assertToolCompatibility('18.6', { pg_dump: 18, pg_restore: 18 }), { serverMajor: 18, compatible: true });
  });
  await t.test('refuse serveur 18 et pg_dump 16', () => {
    assert.throws(() => assertToolCompatibility('18.6', { pg_dump: 16, pg_restore: 18 }), /incompatible/);
  });
});
