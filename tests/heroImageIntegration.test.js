const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('photo NVA locale integree au Hero public', () => {
  const view = fs.readFileSync('views/home.ejs', 'utf8');
  const css = fs.readFileSync('public/css/arena-public.css', 'utf8');
  const image = 'public/images/nva/pic-1.png';

  assert.equal(fs.existsSync(image), true);
  assert.ok(fs.statSync(image).size > 0);
  assert.match(view, /src="\/images\/nva\/pic-1\.png"/);
  assert.match(view, /<picture class="stitch-hero-media" aria-hidden="true">/);
  assert.match(view, /width="1290" height="860"/);
  assert.match(view, /alt=""/);
  assert.doesNotMatch(view, /pic-1\.png[^>]*loading="lazy"/);
  assert.match(view, /fetchpriority="high" decoding="async"/);
  assert.doesNotMatch(view, /lh3\.googleusercontent\.com|aida-public/);
  assert.doesNotMatch(view, /[A-Z]:\\|file:\/\//);
  assert.match(css, /\.stitch-hero-media img[^}]*object-fit:\s*cover/);
});
