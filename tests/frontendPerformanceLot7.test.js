require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = require('../src/app');

const optimizedAssets = [
  'pic-1-640.webp', 'pic-1-1290.webp',
  'pic-3-480.webp', 'pic-3-768.webp', 'pic-3-1024.webp',
  'pic-6-480.webp', 'pic-6-768.webp', 'pic-6-1280.webp',
  'pic-7-768.webp', 'pic-7-1440.webp',
  'pic-8-480.webp', 'pic-8-768.webp', 'pic-8-1024.webp',
  'pic-9-480.webp', 'pic-9-768.webp', 'pic-9-1024.webp',
  'pic-10-480.webp', 'pic-10-768.webp', 'pic-10-1024.webp',
  'logo-icon-192.png', 'logo-navigation-320.png', 'logo-with-tagline-480.png',
];

test('Lot 7 - performance frontend, images et PWA', async (t) => {
  await t.test('génère toutes les variantes optimisées sans supprimer les originaux', () => {
    for (const file of optimizedAssets) assert.ok(fs.statSync(`public/images/optimized/${file}`).size > 0, file);
    for (const file of ['pic-1.png', 'pic-3.png', 'pic-6.png', 'pic-8.png', 'pic-9.png', 'pic-10.png']) assert.ok(fs.existsSync(`public/images/nva/${file}`));
  });

  await t.test('utilise picture, srcset, sizes, lazy loading et une seule priorité LCP par page', () => {
    const home = fs.readFileSync('views/home.ejs', 'utf8');
    assert.match(home, /pic-1-640\.webp 640w/);
    assert.match(home, /loading="eager" fetchpriority="high"/);
    assert.match(home, /pic-3-480\.webp 480w[\s\S]*sizes=/);
    assert.match(home, /pic-10-480\.webp 480w[\s\S]*loading="lazy"/);
    assert.equal((home.match(/fetchpriority="high"/g) || []).length, 1);
    for (const view of ['views/auth/login.ejs', 'views/public/registration/new.ejs']) {
      const source = fs.readFileSync(view, 'utf8');
      assert.match(source, /type="image\/webp"/);
      assert.equal((source.match(/fetchpriority="high"/g) || []).length, 1);
    }
  });

  await t.test('bypasse tout cache PWA pour les parcours privés et formulaires à jeton', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    for (const prefix of ['/admin', '/teacher', '/student', '/payments', '/login', '/register', '/reset-password', '/change-password']) assert.match(sw, new RegExp(`'${prefix.replace('/', '\\/')}'`));
    assert.match(sw, /request\.method !== 'GET'/);
    assert.match(sw, /!response\.headers\.has\('set-cookie'\)/);
  });

  await t.test('versionne le cache et aligne le précache avec les URLs HTML', () => {
    const sw = fs.readFileSync('public/sw.js', 'utf8');
    const header = fs.readFileSync('views/partials/header.ejs', 'utf8');
    for (const url of ['/css/style.css?v=nva-performance-20260830-1', '/css/arena-public.css?v=nva-performance-20260830-1']) {
      assert.ok(sw.includes(url)); assert.ok(header.includes(url));
    }
    assert.match(sw, /new-vision-academy-v16/);
  });

  await t.test('sert chaque nouvel asset en HTTP 200 avec son MIME', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      for (const file of optimizedAssets) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/images/optimized/${file}`);
        assert.equal(response.status, 200, file);
        assert.match(response.headers.get('content-type') || '', file.endsWith('.webp') ? /image\/webp/ : /image\/png/);
      }
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
