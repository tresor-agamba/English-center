const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

test('le stockage LMS privé respecte PRIVATE_STORAGE_ROOT', () => {
  const modulePath = require.resolve('../src/services/lmsResourceService');
  const previous = process.env.PRIVATE_STORAGE_ROOT;
  const configuredRoot = path.join(os.tmpdir(), 'nva-private-storage-audit');
  process.env.PRIVATE_STORAGE_ROOT = configuredRoot;
  delete require.cache[modulePath];

  try {
    const storage = require(modulePath);
    assert.equal(storage.PRIVATE_ROOT, path.resolve(configuredRoot, 'lms'));
    assert.equal(storage.resolveKey(`2026/${'a'.repeat(36)}.pdf`), path.resolve(configuredRoot, 'lms', '2026', `${'a'.repeat(36)}.pdf`));
    assert.throws(() => storage.resolveKey('../../public/secret.pdf'), /Ressource introuvable/);
  } finally {
    if (previous === undefined) delete process.env.PRIVATE_STORAGE_ROOT;
    else process.env.PRIVATE_STORAGE_ROOT = previous;
    delete require.cache[modulePath];
  }
});
