require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const http = require('http');
const app = require('../../src/app');

function request(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

test('Phase 11 — Progressive Web App', async (t) => {
  let manifest;
  await t.test('sert un manifest valide et installable', async () => {
    const response = await request('/manifest.webmanifest');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^application\/manifest\+json/);
    manifest = JSON.parse(response.body);
    assert.ok(manifest.name); assert.ok(manifest.short_name);
    assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
    assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
    assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  });
  await t.test('fournit toutes les icônes PWA', async () => {
    for (const size of [72, 96, 128, 144, 152, 192, 384, 512]) {
      const data = await fs.readFile(`public/icons/icon-${size}.png`);
      assert.equal(data.subarray(1, 4).toString(), 'PNG');
    }
    await fs.access('public/icons/icon-512-maskable.png');
    await fs.access('public/icons/apple-touch-icon.png');
    await fs.access('public/favicon.ico');
  });
  await t.test('sert le service worker avec MIME et sans cache HTTP durable', async () => {
    const response = await request('/sw.js');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /^application\/javascript/);
    assert.match(response.headers['cache-control'], /no-cache/);
    assert.match(response.body, /CACHE_VERSION/);
    assert.match(response.body, /caches\.delete/);
  });
  await t.test('interdit le cache privé et ignore les méthodes mutantes', async () => {
    const source = await fs.readFile('public/sw.js', 'utf8');
    for (const prefix of ['/admin', '/teacher', '/student', '/api', '/health']) assert.ok(source.includes(`'${prefix}'`));
    assert.match(source, /request\.method !== 'GET'/);
    assert.match(source, /PRIVATE_FILE_PATTERN/);
    assert.doesNotMatch(source, /localStorage|indexedDB/i);
  });
  await t.test('sert une page hors connexion autonome', async () => {
    const response = await request('/offline');
    assert.equal(response.status, 200);
    assert.match(response.body, /Vous êtes hors connexion/);
    assert.doesNotMatch(response.body, /<link[^>]+stylesheet|<script[^>]+src=/);
  });
  await t.test('enregistre le service worker et gère installation, iOS, standalone et mise à jour', async () => {
    const [source, header, footer] = await Promise.all([
      fs.readFile('public/js/pwa.js', 'utf8'),
      fs.readFile('views/partials/header.ejs', 'utf8'),
      fs.readFile('views/partials/footer.ejs', 'utf8'),
    ]);
    assert.match(source, /serviceWorker\.register\('\/sw\.js'/);
    assert.match(source, /beforeinstallprompt/);
    assert.match(source, /display-mode: standalone/);
    assert.match(source, /iphone\|ipad\|ipod/i);
    assert.match(source, /SKIP_WAITING/);
    assert.match(header, /manifest\.webmanifest/);
    assert.match(footer, /data-pwa-install/);
  });
  await t.test('conserve une CSP locale compatible PWA', async () => {
    const response = await request('/');
    const csp = response.headers['content-security-policy'];
    assert.match(csp, /manifest-src 'self'/);
    assert.match(csp, /worker-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  });
});
