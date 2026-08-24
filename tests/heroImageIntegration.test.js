const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('photo Stitch locale integree au Hero public', () => {
  const view = fs.readFileSync('views/home.ejs', 'utf8');
  const css = fs.readFileSync('public/css/style.css', 'utf8');
  const image = 'public/images/hero/stitch-classroom-learners.jpg';

  assert.equal(fs.existsSync(image), true);
  assert.ok(fs.statSync(image).size > 0);
  assert.ok(fs.statSync(image).size < 200 * 1024);
  assert.match(view, /src="\/images\/hero\/stitch-classroom-learners\.jpg"/);
  assert.match(view, /<picture class="stitch-hero-media" aria-hidden="true">/);
  assert.match(view, /width="512" height="286"/);
  assert.match(view, /alt=""/);
  assert.match(view, /loading="eager" fetchpriority="high" decoding="async"/);
  assert.doesNotMatch(view, /lh3\.googleusercontent\.com|aida-public/);
  assert.doesNotMatch(view, /[A-Z]:\\|file:\/\//);
  assert.match(css, /\.stitch-hero-media img[^}]*object-fit:\s*cover/);
});
