const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('le layout administratif reste séparé visuellement sans toucher au métier', async () => {
  const [header, footer, navigation, dashboard, css] = await Promise.all([
    fs.readFile('views/partials/header.ejs', 'utf8'),
    fs.readFile('views/partials/footer.ejs', 'utf8'),
    fs.readFile('views/admin/_nav.ejs', 'utf8'),
    fs.readFile('views/admin/dashboard.ejs', 'utf8'),
    fs.readFile('public/css/style.css', 'utf8'),
  ]);

  assert.equal((header.match(/<main\b/g) || []).length, 1);
  assert.equal((footer.match(/<\/main>/g) || []).length, 1);
  assert.match(navigation, /<nav class="admin-nav" data-admin-navigation aria-label="Navigation administration">/);
  assert.match(dashboard, /include\('\.\.\/partials\/header'/);
  assert.match(dashboard, /include\('\.\.\/partials\/footer'\)/);
  assert.match(dashboard, /include\('_nav'\)/);

  assert.match(css, /--public-header-height:\s*78px/);
  assert.match(css, /--admin-header-height:\s*76px/);
  assert.match(css, /body:has\(\.admin-nav\) \.public-main\s*\{[^}]*padding-top:/s);
  assert.match(css, /\.admin-nav\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.doesNotMatch(css, /\.admin-nav\s*\{[^}]*margin:\s*-\d/s);
  assert.doesNotMatch(css, /\.admin-nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.doesNotMatch(dashboard, /style\s*=/);
});
