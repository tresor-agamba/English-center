const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

test('le layout administratif utilise un shell privé dédié sans toucher au métier', async () => {
  const [header, footer, navigation, legacyNavigation, dashboard, css, script, middleware] = await Promise.all([
    fs.readFile('views/partials/header.ejs', 'utf8'),
    fs.readFile('views/partials/footer.ejs', 'utf8'),
    fs.readFile('views/admin/_sidebar.ejs', 'utf8'),
    fs.readFile('views/admin/_nav.ejs', 'utf8'),
    fs.readFile('views/admin/dashboard.ejs', 'utf8'),
    fs.readFile('public/css/admin.css', 'utf8'),
    fs.readFile('public/js/admin.js', 'utf8'),
    fs.readFile('src/middlewares/requireAdmin.js', 'utf8'),
  ]);

  assert.equal((header.match(/<main\b/g) || []).length, 1);
  assert.equal((footer.match(/<\/main>/g) || []).length, 1);
  assert.match(header, /isAdminLayout/);
  assert.match(header, /include\('\.\.\/admin\/_sidebar'\)/);
  assert.match(header, /nva-admin-body/);
  assert.match(footer, /class="admin-footer"/);
  assert.match(navigation, /class="admin-sidebar" data-admin-navigation/);
  assert.match(navigation, /action="\/logout"/);
  assert.match(navigation, /aria-current="page"/);
  assert.doesNotMatch(legacyNavigation, /<nav\b/);
  assert.match(dashboard, /include\('\.\.\/partials\/header'/);
  assert.match(dashboard, /include\('\.\.\/partials\/footer'\)/);
  assert.match(dashboard, /include\('_nav'\)/);

  assert.match(css, /\.nva-admin-body \.admin-sidebar/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(script, /aria-expanded/);
  assert.match(script, /Escape/);
  assert.match(middleware, /layoutContext = 'admin'/);
  assert.doesNotMatch(dashboard, /style\s*=/);
});
